import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

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
    const userResponse = await fetch('https://api.mercadolibre.com/users/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

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

    console.log(`Buscando ventas desde ${dateFrom} hasta ${dateTo}`);

    // 3. Obtener todas las órdenes de los últimos 60 días
    let allOrders: any[] = [];
    let offset = 0;
    const limit = 50; // ML devuelve máximo 50 por página
    let hasMore = true;
    let totalFound = 0;

    while (hasMore) {
      const ordersResponse = await fetch(
        `https://api.mercadolibre.com/orders/search?seller=${userId}&order.date_created.from=${encodeURIComponent(dateFrom)}&order.date_created.to=${encodeURIComponent(dateTo)}&offset=${offset}&limit=${limit}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );

      if (!ordersResponse.ok) {
        console.error(`Error obteniendo órdenes (offset ${offset}):`, ordersResponse.status);
        break;
      }

      const ordersData = await ordersResponse.json();
      const results = ordersData.results || [];
      allOrders = allOrders.concat(results);
      
      // Verificar si hay más páginas
      totalFound = ordersData.paging?.total || 0;
      offset += limit;
      hasMore = offset < totalFound && results.length > 0;
      
      console.log(`Cargadas ${allOrders.length} de ${totalFound} órdenes`);
      
      // Límite de seguridad: no más de 2000 órdenes (40 páginas)
      if (offset >= 2000) {
        console.log('Alcanzado límite de seguridad de 2000 órdenes');
        break;
      }
    }

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
    
    console.log(`Total de unidades vendidas en todas las órdenes: ${totalUnits}`);

    // 5. Obtener los SKUs de cada item vendido y agrupar unidades por SKU
    const itemIds = Object.keys(itemSales);
    const salesBySKU: { [sku: string]: number } = {};
    let processedItems = 0;

    // Procesar en batches de 20 (límite de multiget de ML)
    for (let i = 0; i < itemIds.length; i += 20) {
      const batch = itemIds.slice(i, i + 20);
      const idsParam = batch.join(',');
      
      const itemsResponse = await fetch(
        `https://api.mercadolibre.com/items?ids=${idsParam}&attributes=id,attributes`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
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
      }
    }
    
    console.log(`Procesados ${processedItems} items diferentes con ventas`);
    console.log(`SKUs con ventas: ${Object.keys(salesBySKU).length}`);

    return NextResponse.json({
      salesBySKU,
      totalOrders: allOrders.length,
      totalUnitsAllSKUs: totalUnits,
      periodDays: 60,
      dateFrom,
      dateTo,
    });

  } catch (error) {
    console.error('Error obteniendo ventas:', error);
    return NextResponse.json(
      { error: 'Error obteniendo ventas' },
      { status: 500 }
    );
  }
}
