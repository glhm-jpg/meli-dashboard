import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// Función helper para hacer delay entre requests
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Función helper para retry con exponential backoff
async function fetchWithRetry(url: string, options: any, retries = 3, delayMs = 1000): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      
      if (response.ok) {
        return response;
      }
      
      if (response.status === 429 || response.status === 503) {
        const waitTime = delayMs * Math.pow(2, i);
        console.log(`Rate limited. Esperando ${waitTime}ms antes de reintentar...`);
        await delay(waitTime);
        continue;
      }
      
      return response;
    } catch (error) {
      console.error(`Intento ${i + 1} falló:`, error);
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

  console.log('📋 [PRODUCTS API] Petición recibida');
  console.log('📋 [PRODUCTS API] Token encontrado:', accessToken ? 'SÍ' : 'NO');

  if (!accessToken) {
    console.error('❌ [PRODUCTS API] No autenticado');
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  try {
    console.log('📋 [PRODUCTS API] Obteniendo información del usuario...');
    const userResponse = await fetchWithRetry(
      'https://api.mercadolibre.com/users/me',
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );

    if (!userResponse.ok) {
      console.error('❌ [PRODUCTS API] Error obteniendo usuario:', userResponse.status);
      if (userResponse.status === 401) {
        return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
      }
      throw new Error('Error obteniendo usuario');
    }

    const userData = await userResponse.json();
    const userId = userData.id;
    console.log('✅ [PRODUCTS API] Usuario obtenido:', userId);

    const searchParams = request.nextUrl.searchParams;
    const offset = searchParams.get('offset') || '0';
    const limit = searchParams.get('limit') || '50';

    console.log(`📋 [PRODUCTS API] Obteniendo productos - offset: ${offset}, limit: ${limit}`);

    const itemsResponse = await fetchWithRetry(
      `https://api.mercadolibre.com/users/${userId}/items/search?status=active,paused,closed,under_review,inactive&offset=${offset}&limit=${limit}`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );

    if (!itemsResponse.ok) {
      console.error('❌ [PRODUCTS API] Error obteniendo publicaciones:', itemsResponse.status);
      throw new Error('Error obteniendo publicaciones');
    }

    const itemsData = await itemsResponse.json();
    const itemIds = itemsData.results;
    const total = itemsData.paging.total;

    console.log(`✅ [PRODUCTS API] Encontrados ${itemIds.length} IDs de productos`);
    console.log(`📊 [PRODUCTS API] Total productos en cuenta: ${total}`);

    const products = [];
    
    for (let i = 0; i < itemIds.length; i += 20) {
      const batch = itemIds.slice(i, i + 20);
      const idsParam = batch.join(',');
      
      if (i > 0) {
        await delay(500);
      }
      
      console.log(`📋 [PRODUCTS API] Obteniendo detalles del batch ${Math.floor(i/20) + 1}/${Math.ceil(itemIds.length/20)}`);
      
      const detailsResponse = await fetchWithRetry(
        `https://api.mercadolibre.com/items?ids=${idsParam}&attributes=id,title,price,available_quantity,sold_quantity,status,permalink,thumbnail,pictures,shipping,attributes`,
        { headers: { 'Authorization': `Bearer ${accessToken}` } },
        3,
        1000
      );

      if (detailsResponse.ok) {
        const details = await detailsResponse.json();
        
        for (const item of details) {
          if (item.code === 200 && item.body) {
            const productData = item.body;
            
            const skuAttribute = productData.attributes?.find((attr: any) => attr.id === 'SELLER_SKU');
            const sku = skuAttribute?.value_name || null;
            
            // 🔥 DEVOLVER OBJETO SHIPPING COMPLETO
            const shipping = {
              mode: productData.shipping?.mode || 'not_specified',
              free_shipping: productData.shipping?.free_shipping || false,
              logistic_type: productData.shipping?.logistic_type || null
            };
            
            products.push({
              id: productData.id,
              title: productData.title,
              price: productData.price,
              available_quantity: productData.available_quantity,
              sold_quantity: productData.sold_quantity || 0,
              status: productData.status,
              permalink: productData.permalink,
              thumbnail: productData.thumbnail || productData.pictures?.[0]?.url || '',
              shipping: shipping,
              sku: sku
            });
          } else if (item.code !== 200) {
            console.warn(`⚠️ [PRODUCTS API] Item ${item.body?.id || 'unknown'} retornó código ${item.code}`);
          }
        }
      } else {
        console.error(`❌ [PRODUCTS API] Error obteniendo detalles del batch: ${detailsResponse.status}`);
      }
    }

    console.log(`✅ [PRODUCTS API] Total procesados: ${products.length} de ${itemIds.length} IDs`);

    return NextResponse.json({
      products: products,
      total: total,
      offset: parseInt(offset),
      limit: parseInt(limit)
    });

  } catch (error) {
    console.error('❌ [PRODUCTS API] Error:', error);
    return NextResponse.json({ error: 'Error obteniendo productos' }, { status: 500 });
  }
}
