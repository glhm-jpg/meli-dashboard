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

    const searchParams = request.nextUrl.searchParams;
    const offset = searchParams.get('offset') || '0';
    const limit = searchParams.get('limit') || '50';

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

    const products = [];
    
    for (let i = 0; i < itemIds.length; i += 20) {
      const batch = itemIds.slice(i, i + 20);
      const idsParam = batch.join(',');
      
      const detailsResponse = await fetch(
        `https://api.mercadolibre.com/items?ids=${idsParam}&attributes=id,title,price,available_quantity,status,permalink,last_updated,shipping,seller_custom_field`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );

      if (detailsResponse.ok) {
        const details = await detailsResponse.json();
        
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
