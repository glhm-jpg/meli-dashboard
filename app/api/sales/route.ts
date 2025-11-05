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
    
    // Formato ISO para la API de ML
    const dateFrom = sixtyDaysAgo.toISOString();
    const dateTo = today.toISOString();

    // 3. Obtener todas las órdenes de los últimos 60 días
    let allOrders: any[] = [];
    let offset = 0;
    const limit = 50; // ML devuelve máximo 50 por página
    let hasMore = true;

    while (hasMore) {
      const ordersResponse = await fetch(
        `https://api.mercadolibre.com/orders/search?seller=${userId}&order.date_created.from=${dateFrom}&order.date_created.to=${dateTo}&offset=${offset}&limit=${limit}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );

      if (!ordersResponse.ok) {
        console.error('Error obteniendo órdenes');
        break;
      }

      const ordersData = await ordersResponse.json();
      allOrders = allOrders.concat(ordersData.results || []);
      
      // Verificar si hay más páginas
      const total = ordersData.paging?.total || 0;
      offset += limit;
      hasMore = offset < total;
      
      // Límite de seguridad: no más de 1000 órdenes (20 páginas)
      if (offset >= 1000) {
        break;
      }
    }

    // 4. Extraer todos los item_ids vendidos con sus cantidades
    const itemSales: { [itemId: string]: number } = {};
    
    for (const order of allOrders) {
      if (order.order_items && Array.isArray(order.order_items)) {
        for (const orderItem of order.order_items) {
          const itemId = orderItem.item?.id;
          const quantity = orderItem.quantity || 0;
          
          if (itemId) {
            itemSales[itemId] = (itemSales[itemId] || 0) + quantity;
          }
        }
      }
    }

    // 5. Obtener los SKUs de cada item vendido
    const itemIds = Object.keys(itemSales);
    const salesBySKU: { [sku: string]: number } = {};

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
            
            // Sumar las ventas a este SKU
            const quantity = itemSales[itemId] || 0;
            salesBySKU[sku] = (salesBySKU[sku] || 0) + quantity;
          }
        }
      }
    }

    return NextResponse.json({
      salesBySKU,
      totalOrders: allOrders.length,
      periodDays: 60,
    });

  } catch (error) {
    console.error('Error obteniendo ventas:', error);
    return NextResponse.json(
      { error: 'Error obteniendo ventas' },
      { status: 500 }
    );
  }
}
