import { NextResponse } from 'next/server';

export async function GET() {
  const appId = process.env.MELI_APP_ID;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/callback`;

  if (!appId) {
    return NextResponse.json(
      { error: 'MELI_APP_ID no configurado' },
      { status: 500 }
    );
  }

  const authUrl = `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${appId}&redirect_uri=${redirectUri}`;

  return NextResponse.redirect(authUrl);
}
