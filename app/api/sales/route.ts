import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// Función helper para hacer delay entre requests
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Función helper para retry con exponential backoff
async function fetchWithRetry(url: string, options: any, retries = 3, delayMs = 1000): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      
      // Si es exitoso, retornar
      if (response.ok) {
        return response;
      }
      
      // Si es 429 (rate limit) o 503 (service unavailable), esperar más tiempo
      if (response.status === 429 || response.status === 503) {
        const waitTime = delayMs * Math.pow(2, i); // Exponential backoff
        console.log(`Rate limited en ventas. Esperando ${waitTime}ms antes de reintentar...`);
        await delay(waitTime);
        continue;
      }
      
      // Para otros errores, retornar la respuesta
      return response;
    } catch (error) {
      console.error(`Intento ${i + 1} falló en ventas:`, error);
      if (i < retries - 1) {
        await delay(delayMs * Math.pow(2, i));
      } else {
        throw error;
      }
    }
  }
  
  throw new Error('Max retries alcanzado');
}

export async function GET(request: NextRequest) {
  const cookieStore = cookies();
  const accessToken = cookieStore.get('meli_access_token')?.value;

  if (!accessToken) {
    return NextResponse.json(
      { error: 'No autenticado' },
      { status: 401 }
    );
  }

  try {
    // 1. Obtener información del usuario
    const userResponse = await fetchWithRetry(
      'https://api.mercadolibre.com/users/me',
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );

    if (!userResponse.ok) {
      throw new Error('Error obteniendo usuario');
    }

    const userData = await userResponse.json();
    const userId = userData.id;

    // 2. Calcular fecha de hace 60 días
    const today = new Date();
    const sixtyDaysAgo = new Date(today);
    sixtyDaysAgo.setDate(today.getDate() - 60);
    
    // Formato para la API de ML (sin milisegundos, formato correcto)
    const dateFrom = sixtyDaysAgo.toISOString().split('.')[0] + 'Z';
    const dateTo = today.toISOString().split('.')[0] + 'Z';

    console.log(`[VENTAS] Buscando ventas desde ${dateFrom} hasta ${dateTo}`);

    // 3. Obtener todas las órdenes de los últimos 60 días
    let allOrders: any[] = [];
    let offset = 0;
    const limit = 50; // ML devuelve máximo 50 por página
    let hasMore = true;
    let totalFound = 0;
    let failedAttempts = 0;
    const maxFailedAttempts = 3;

    while (hasMore && failedAttempts < maxFailedAttempts) {
      try {
        // Agregar delay entre peticiones
        if (offset > 0) {
          await delay(800); // 800ms entre cada página
        }

        const ordersResponse = await fetchWithRetry(
          `https://api.mercadolibre.com/orders/search?seller=${userId}&order.date_created.from=${encodeURIComponent(dateFrom)}&order.date_created.to=${encodeURIComponent(dateTo)}&offset=${offset}&limit=${limit}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
            },
          },
          3, // 3 reintentos
          2000 // 2 segundos inicial
        );

        if (!ordersResponse.ok) {
          console.error(`[VENTAS] Error obteniendo órdenes (offset ${offset}): ${ordersResponse.status}`);
          failedAttempts++;
          if (failedAttempts >= maxFailedAttempts) {
            console.warn(`[VENTAS] Máximo de intentos fallidos alcanzado. Continuando con ${allOrders.length} órdenes obtenidas.`);
            break;
          }
          await delay(3000); // Esperar 3 segundos antes del siguiente intento
          continue;
        }

        const ordersData = await ordersResponse.json();
        const results = ordersData.results || [];
        allOrders = allOrders.concat(results);
        
        // Verificar si hay más páginas
        totalFound = ordersData.paging?.total || 0;
        offset += limit;
        hasMore = offset < totalFound && results.length > 0;
        
        console.log(`[VENTAS] Cargadas ${allOrders.length} de ${totalFound} órdenes`);
        
        // Reset failed attempts si fue exitoso
        failedAttempts = 0;
        
        // Límite de seguridad: no más de 2000 órdenes (40 páginas)
        if (offset >= 2000) {
          console.log('[VENTAS] Alcanzado límite de seguridad de 2000 órdenes');
          break;
        }
      } catch (error) {
        console.error(`[VENTAS] Error en paginación:`, error);
        failedAttempts++;
        if (failedAttempts >= maxFailedAttempts) {
          break;
        }
        await delay(3000);
      }
    }

    console.log(`[VENTAS] Total órdenes obtenidas: ${allOrders.length}`);

    // 4. Extraer todos los item_ids vendidos con sus cantidades (UNIDADES, no transacciones)
    const itemSales: { [itemId: string]: number } = {};
    let totalUnits = 0;
    
    for (const order of allOrders) {
      if (order.order_items && Array.isArray(order.order_items)) {
        for (const orderItem of order.order_items) {
          const itemId = orderItem.item?.id;
          const quantity = orderItem.quantity || 0;
          
          if (itemId && quantity > 0) {
            itemSales[itemId] = (itemSales[itemId] || 0) + quantity;
            totalUnits += quantity;
          }
        }
      }
    }
    
    console.log(`[VENTAS] Total de unidades vendidas en todas las órdenes: ${totalUnits}`);
    console.log(`[VENTAS] Items únicos con ventas: ${Object.keys(itemSales).length}`);

    // 5. Obtener los SKUs de cada item vendido y agrupar unidades por SKU
    const itemIds = Object.keys(itemSales);
    const salesBySKU: { [sku: string]: number } = {};
    let processedItems = 0;

    // Procesar en batches de 20 (límite de multiget de ML)
    for (let i = 0; i < itemIds.length; i += 20) {
      const batch = itemIds.slice(i, i + 20);
      const idsParam = batch.join(',');
      
      // Agregar delay entre batches
      if (i > 0) {
        await delay(1000); // 1 segundo entre cada batch
      }
      
      console.log(`[VENTAS] Procesando batch de SKUs ${Math.floor(i/20) + 1}/${Math.ceil(itemIds.length/20)}`);
      
      try {
        const itemsResponse = await fetchWithRetry(
          `https://api.mercadolibre.com/items?ids=${idsParam}&attributes=id,attributes`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
            },
          },
          3, // 3 reintentos
          2000 // 2 segundos inicial
        );

        if (itemsResponse.ok) {
          const items = await itemsResponse.json();
          
          for (const item of items) {
            if (item.code === 200 && item.body) {
              const itemId = item.body.id;
              const attributes = item.body.attributes || [];
              
              // Buscar el SKU en los atributos
              const skuAttribute = attributes.find((attr: any) => attr.id === 'SELLER_SKU');
              const sku = skuAttribute?.value_name || 'SIN-SKU';
              
              // Sumar las UNIDADES vendidas a este SKU
              const units = itemSales[itemId] || 0;
              salesBySKU[sku] = (salesBySKU[sku] || 0) + units;
              processedItems++;
            }
          }
        } else {
          console.error(`[VENTAS] Error obteniendo SKUs del batch: ${itemsResponse.status}`);
        }
      } catch (error) {
        console.error(`[VENTAS] Error procesando batch de SKUs:`, error);
      }
    }
    
    console.log(`[VENTAS] Procesados ${processedItems} items diferentes con ventas`);
    console.log(`[VENTAS] SKUs con ventas: ${Object.keys(salesBySKU).length}`);
    
    // Mostrar top 5 SKUs más vendidos para debugging
    const topSKUs = Object.entries(salesBySKU)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    console.log(`[VENTAS] Top 5 SKUs más vendidos:`, topSKUs);

    return NextResponse.json({
      salesBySKU,
      totalOrders: allOrders.length,
      totalUnitsAllSKUs: totalUnits,
      totalItemsWithSales: processedItems,
      periodDays: 60,
      dateFrom,
      dateTo,
    });

  } catch (error) {
    console.error('[VENTAS] Error obteniendo ventas:', error);
    return NextResponse.json(
      { error: 'Error obteniendo ventas' },
      { status: 500 }
    );
  }
}
