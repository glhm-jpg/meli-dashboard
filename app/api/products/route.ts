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

    // 2. Obtener IDs de todas las publicaciones del usuario
    const searchParams = request.nextUrl.searchParams;
    const offset = searchParams.get('offset') || '0';
    const limit = searchParams.get('limit') || '50'; // Máximo 50 por request

    const itemsResponse = await fetch(
      `https://api.mercadolibre.com/users/${userId}/items/search?status=active,paused,closed&offset=${offset}&limit=${limit}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );

    if (!itemsResponse.ok) {
      throw new Error('Error obteniendo publicaciones');
    }

    const itemsData = await itemsResponse.json();
    const itemIds = itemsData.results;
    const total = itemsData.paging.total;

    // 3. Obtener detalles de cada publicación
    // Usar multiget para obtener hasta 20 items por request
    const products = [];
    
    for (let i = 0; i < itemIds.length; i += 20) {
      const batch = itemIds.slice(i, i + 20);
      const idsParam = batch.join(',');
      
      const detailsResponse = await fetch(
        `https://api.mercadolibre.com/items?ids=${idsParam}&attributes=id,title,price,available_quantity,status,permalink,last_updated,shipping,attributes`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );

      if (detailsResponse.ok) {
        const details = await detailsResponse.json();
        
        // Procesar cada item del batch
        for (const item of details) {
          if (item.code === 200 && item.body) {
            products.push(item.body);
          }
        }
      }
    }

    return NextResponse.json({
      products,
      total,
      offset: parseInt(offset),
      limit: parseInt(limit),
    });

  } catch (error) {
    console.error('Error obteniendo productos:', error);
    return NextResponse.json(
      { error: 'Error obteniendo productos' },
      { status: 500 }
    );
  }
}
