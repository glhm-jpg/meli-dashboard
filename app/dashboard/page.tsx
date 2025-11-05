'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Product {
  id: string;
  title: string;
  price: number;
  available_quantity: number;
  sold_quantity: number;
  permalink: string;
  thumbnail: string;
  status: string;
  fulfillment?: string;
  sku?: string;
}

interface Stats {
  totalProducts: number;
  totalStock: number;
  totalSold: number;
  averagePrice: number;
}

export default function Dashboard() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [fulfillmentFilter, setFulfillmentFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState('Iniciando carga...');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchAllProducts();
  }, []);

  useEffect(() => {
    filterProducts();
  }, [products, searchTerm, fulfillmentFilter, statusFilter]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, fulfillmentFilter, statusFilter, itemsPerPage]);

  const fetchAllProducts = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      setLoadingMessage('🔐 Validando autenticación...');
      setLoadingProgress(0);

      console.log('📋 [DASHBOARD] Iniciando carga de productos...');

      // Primera petición para obtener el total y validar autenticación
      console.log('📋 [DASHBOARD] Realizando primera petición...');
      const firstResponse = await fetch('/api/products?offset=0&limit=50');
      
      console.log('📋 [DASHBOARD] Status de primera respuesta:', firstResponse.status);

      // Si no está autenticado, redirigir
      if (firstResponse.status === 401) {
        console.error('❌ [DASHBOARD] No autenticado (401) - Redirigiendo al login...');
        setLoadError('Sesión expirada. Redirigiendo al login...');
        setTimeout(() => router.push('/'), 2000);
        return;
      }

      if (!firstResponse.ok) {
        const errorText = await firstResponse.text();
        console.error('❌ [DASHBOARD] Error en primera petición:', firstResponse.status, errorText);
        throw new Error(`Error ${firstResponse.status}: ${errorText}`);
      }

      const firstData = await firstResponse.json();
      console.log('✅ [DASHBOARD] Primera respuesta recibida:', {
        totalProductos: firstData.total,
        productosCargados: firstData.products?.length || 0
      });

      const totalProducts = firstData.total;
      
      if (!totalProducts || totalProducts === 0) {
        setLoadError('No se encontraron productos en tu cuenta.');
        setLoading(false);
        return;
      }

      // 🔥 CARGAR TODOS LOS PRODUCTOS (sin límite)
      const batchSize = 50;
      const totalBatches = Math.ceil(totalProducts / batchSize);
      
      // Tiempo estimado: 1 segundo por batch
      const estimatedMinutes = Math.ceil(totalBatches / 60);
      
      setLoadingMessage(`📦 Cargando ${totalProducts.toLocaleString()} productos en ${totalBatches} lotes (≈${estimatedMinutes} min)`);
      
      // Extraer productos del primer batch
      let allProducts: Product[] = [];
      if (firstData.products && Array.isArray(firstData.products)) {
        allProducts = firstData.products.map((p: any) => ({
          id: p.id,
          title: p.title,
          price: p.price,
          available_quantity: p.available_quantity,
          sold_quantity: p.sold_quantity || 0,
          permalink: p.permalink,
          thumbnail: p.thumbnail || p.pictures?.[0]?.url || '',
          status: p.status,
          fulfillment: p.shipping?.logistic_type,
          sku: p.attributes?.find((attr: any) => attr.id === 'SELLER_SKU')?.value_name
        }));
      }

      setLoadingProgress(Math.round((1 / totalBatches) * 100));
      console.log('✅ [DASHBOARD] Primer lote cargado:', allProducts.length, 'productos');

      // 🔥 Cargar el resto con DELAYS progresivos
      for (let i = 1; i < totalBatches; i++) {
        const offset = i * batchSize;
        
        // ✅ DELAY DE 1 SEGUNDO entre peticiones
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const percentComplete = Math.round(((i + 1) / totalBatches) * 100);
        const productsLoaded = Math.min((i + 1) * batchSize, totalProducts);
        
        setLoadingMessage(`⏳ Lote ${i + 1}/${totalBatches} - ${productsLoaded.toLocaleString()}/${totalProducts.toLocaleString()} productos (${percentComplete}%)`);
        
        // ✅ RETRY LOGIC: 3 intentos si falla
        let attempts = 0;
        let success = false;
        
        while (attempts < 3 && !success) {
          try {
            console.log(`📋 [DASHBOARD] Cargando lote ${i + 1}/${totalBatches} (offset: ${offset})`);
            
            const response = await fetch(`/api/products?offset=${offset}&limit=${batchSize}`);
            
            // Verificar si la sesión expiró a mitad de la carga
            if (response.status === 401) {
              console.error('❌ [DASHBOARD] Sesión expiró durante la carga');
              setLoadError('Sesión expirada durante la carga. Redirigiendo...');
              setTimeout(() => router.push('/'), 2000);
              return;
            }
            
            if (!response.ok) {
              throw new Error(`Error ${response.status}`);
            }
            
            const data = await response.json();
            
            // Validar que los datos sean correctos
            if (!data.products || !Array.isArray(data.products)) {
              throw new Error('Respuesta inválida de la API');
            }
            
            // Procesar productos del batch
            const batchProducts = data.products.map((p: any) => ({
              id: p.id,
              title: p.title,
              price: p.price,
              available_quantity: p.available_quantity,
              sold_quantity: p.sold_quantity || 0,
              permalink: p.permalink,
              thumbnail: p.thumbnail || p.pictures?.[0]?.url || '',
              status: p.status,
              fulfillment: p.shipping?.logistic_type,
              sku: p.attributes?.find((attr: any) => attr.id === 'SELLER_SKU')?.value_name
            }));
            
            allProducts = [...allProducts, ...batchProducts];
            success = true;
            
            // Log cada 20 lotes
            if (i % 20 === 0) {
              console.log(`✅ [DASHBOARD] Lote ${i}/${totalBatches} - Total acumulado: ${allProducts.length}`);
            }
            
          } catch (error) {
            attempts++;
            console.error(`❌ [DASHBOARD] Error en lote ${i + 1}, intento ${attempts}/3:`, error);
            
            if (attempts < 3) {
              setLoadingMessage(`⚠️ Reintentando lote ${i + 1}... (intento ${attempts + 1}/3)`);
              await new Promise(resolve => setTimeout(resolve, 2000)); // 2 seg si falla
            } else {
              console.error(`❌ [DASHBOARD] Lote ${i + 1} falló después de 3 intentos`);
              setLoadError(`Error cargando lote ${i + 1}. Se cargaron ${allProducts.length} productos de ${totalProducts}.`);
              // Continuar con los productos cargados hasta ahora
              success = true; // Para salir del while
            }
          }
        }
        
        setLoadingProgress(percentComplete);
      }

      setLoadingMessage('✅ Procesando datos finales...');
      
      console.log(`🎉 [DASHBOARD] CARGA COMPLETA: ${allProducts.length} de ${totalProducts} productos`);
      
      setProducts(allProducts);
      calculateStats(allProducts);
      
      // Verificar SKUs únicos
      const uniqueSKUs = new Set(allProducts.map(p => p.sku).filter(Boolean));
      console.log(`📦 [DASHBOARD] SKUs únicos encontrados: ${uniqueSKUs.size}`);
      
      setLoadingMessage('¡Carga completa!');
      
    } catch (error) {
      console.error('❌ [DASHBOARD] Error fatal:', error);
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido al cargar productos';
      setLoadError(errorMessage);
      
      // Si es un error de autenticación, redirigir
      if (errorMessage.includes('401') || errorMessage.includes('autenticado')) {
        setTimeout(() => router.push('/'), 2000);
      }
    } finally {
      setLoading(false);
    }
  };

  const filterProducts = () => {
    let filtered = [...products];

    // Filtro de búsqueda
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(product => 
        product.title.toLowerCase().includes(term) ||
        product.id.includes(term) ||
        (product.sku && product.sku.toLowerCase().includes(term))
      );
    }

    // Filtro de fulfillment
    if (fulfillmentFilter !== 'all') {
      filtered = filtered.filter(product => {
        if (fulfillmentFilter === 'none') {
          return !product.fulfillment;
        }
        return product.fulfillment === fulfillmentFilter;
      });
    }

    // Filtro de estado
    if (statusFilter !== 'all') {
      filtered = filtered.filter(product => product.status === statusFilter);
    }

    setFilteredProducts(filtered);
  };

  const calculateStats = (productList: Product[]) => {
    const totalStock = productList.reduce((sum, p) => sum + p.available_quantity, 0);
    const totalSold = productList.reduce((sum, p) => sum + p.sold_quantity, 0);
    const averagePrice = productList.length > 0
      ? productList.reduce((sum, p) => sum + p.price, 0) / productList.length
      : 0;

    setStats({
      totalProducts: productList.length,
      totalStock,
      totalSold,
      averagePrice,
    });
  };

  const handleLogout = () => {
    document.cookie = 'meli_access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    router.push('/');
  };

  const exportToExcel = () => {
    const headers = ['ID', 'Título', 'Precio', 'Stock', 'Vendidos', 'SKU', 'Fulfillment', 'Estado', 'Enlace'];
    const data = filteredProducts.map(p => [
      p.id,
      p.title,
      p.price,
      p.available_quantity,
      p.sold_quantity,
      p.sku || 'N/A',
      p.fulfillment || 'Normal',
      p.status,
      p.permalink
    ]);

    let csv = headers.join(',') + '\n';
    data.forEach(row => {
      csv += row.map(cell => `"${cell}"`).join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `productos_ml_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const getFulfillmentBadge = (fulfillment?: string) => {
    if (!fulfillment) return <span className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-700">Normal</span>;
    
    const badges: { [key: string]: { color: string; label: string } } = {
      'fulfillment': { color: 'bg-blue-100 text-blue-700', label: '📦 Full' },
      'flex': { color: 'bg-purple-100 text-purple-700', label: '⚡ Flex' },
      'normal': { color: 'bg-gray-100 text-gray-700', label: 'Normal' }
    };

    const badge = badges[fulfillment] || { color: 'bg-yellow-100 text-yellow-700', label: '📮 ME' };
    return <span className={`px-2 py-1 text-xs rounded ${badge.color}`}>{badge.label}</span>;
  };

  const getStatusBadge = (status: string) => {
    const badges: { [key: string]: { color: string; label: string } } = {
      'active': { color: 'bg-green-100 text-green-700', label: '🟢 Activo' },
      'paused': { color: 'bg-yellow-100 text-yellow-700', label: '🟡 Pausado' },
      'closed': { color: 'bg-red-100 text-red-700', label: '🔴 Finalizado' },
      'under_review': { color: 'bg-blue-100 text-blue-700', label: '🔵 En revisión' },
      'inactive': { color: 'bg-gray-100 text-gray-700', label: '⚫ Inactivo' }
    };

    const badge = badges[status] || { color: 'bg-gray-100 text-gray-700', label: status };
    return <span className={`px-2 py-1 text-xs rounded ${badge.color}`}>{badge.label}</span>;
  };

  // Paginación
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentProducts = filteredProducts.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);

  const paginate = (pageNumber: number) => setCurrentPage(pageNumber);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-yellow-400 via-yellow-300 to-blue-500 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
          <div className="text-center">
            <div className="mb-4">
              <div className="inline-block animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-yellow-500"></div>
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Cargando Productos</h2>
            <p className="text-gray-600 mb-4 text-sm">{loadingMessage}</p>
            
            {/* Barra de progreso */}
            <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden mb-2">
              <div 
                className="bg-yellow-500 h-full transition-all duration-300 ease-out"
                style={{ width: `${loadingProgress}%` }}
              ></div>
            </div>
            <p className="text-sm text-gray-500 font-bold">{loadingProgress}% completado</p>
            
            {loadError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-xs text-red-600">⚠️ {loadError}</p>
              </div>
            )}
            
            <div className="mt-6 p-4 bg-blue-50 rounded-lg">
              <p className="text-xs text-gray-600 mb-2">
                💡 <strong>Carga progresiva:</strong> Puede tomar varios minutos
              </p>
              <p className="text-xs text-gray-600 mb-2">
                ⏱️ 1 segundo de delay entre cada 50 productos
              </p>
              <p className="text-xs text-gray-500">
                🔍 Abre la consola (F12) para ver logs detallados
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-400 via-yellow-300 to-blue-500 p-4">
      <div className="max-w-[95%] mx-auto">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-3xl font-bold text-gray-800">📊 Dashboard Mercado Libre</h1>
            <button
              onClick={handleLogout}
              className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-6 rounded-lg transition"
            >
              Cerrar Sesión
            </button>
          </div>

          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="bg-blue-50 p-4 rounded-xl">
                <p className="text-sm text-gray-600">Total Productos</p>
                <p className="text-2xl font-bold text-blue-600">{stats.totalProducts.toLocaleString()}</p>
              </div>
              <div className="bg-green-50 p-4 rounded-xl">
                <p className="text-sm text-gray-600">Stock Total</p>
                <p className="text-2xl font-bold text-green-600">{stats.totalStock.toLocaleString()}</p>
              </div>
              <div className="bg-purple-50 p-4 rounded-xl">
                <p className="text-sm text-gray-600">Ventas Totales</p>
                <p className="text-2xl font-bold text-purple-600">{stats.totalSold.toLocaleString()}</p>
              </div>
              <div className="bg-yellow-50 p-4 rounded-xl">
                <p className="text-sm text-gray-600">Precio Promedio</p>
                <p className="text-2xl font-bold text-yellow-600">
                  ${stats.averagePrice.toFixed(2)}
                </p>
              </div>
            </div>
          )}

          {/* Filtros y Búsqueda */}
          <div className="flex gap-4 items-center">
            <input
              type="text"
              placeholder="🔍 Buscar por título, ID o SKU..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
            />
            
            <select
              value={fulfillmentFilter}
              onChange={(e) => setFulfillmentFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
            >
              <option value="all">Todos los envíos</option>
              <option value="fulfillment">📦 Full</option>
              <option value="flex">⚡ Flex</option>
              <option value="normal">📮 Mercado Envíos</option>
              <option value="none">Normal</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
            >
              <option value="all">Todos los estados</option>
              <option value="active">🟢 Activo</option>
              <option value="paused">🟡 Pausado</option>
              <option value="closed">🔴 Finalizado</option>
              <option value="under_review">🔵 En revisión</option>
              <option value="inactive">⚫ Inactivo</option>
            </select>

            <button
              onClick={exportToExcel}
              className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-6 rounded-lg transition whitespace-nowrap"
            >
              📥 Exportar CSV
            </button>
          </div>

          {/* Info de resultados */}
          <div className="mt-4 text-sm text-gray-600">
            Mostrando {currentProducts.length} de {filteredProducts.length} productos
            {searchTerm && ` (filtrados de ${products.length} totales)`}
          </div>
        </div>

        {/* Tabla de Productos */}
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-yellow-500 text-white">
                <tr>
                  <th className="px-4 py-3 text-left w-[5%]">Imagen</th>
                  <th className="px-4 py-3 text-left w-[35%]">Producto</th>
                  <th className="px-4 py-3 text-left w-[8%]">SKU</th>
                  <th className="px-4 py-3 text-right w-[10%]">Precio</th>
                  <th className="px-4 py-3 text-center w-[8%]">Stock</th>
                  <th className="px-4 py-3 text-center w-[8%]">Vendidos</th>
                  <th className="px-4 py-3 text-center w-[12%]">Fulfillment</th>
                  <th className="px-4 py-3 text-center w-[12%]">Estado</th>
                  <th className="px-4 py-3 text-center w-[5%]">Ver</th>
                </tr>
              </thead>
              <tbody>
                {currentProducts.map((product, index) => (
                  <tr key={product.id} className={index % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                    <td className="px-4 py-3">
                      <img 
                        src={product.thumbnail} 
                        alt={product.title}
                        className="w-12 h-12 object-cover rounded"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800">{product.title}</div>
                      <div className="text-xs text-gray-500">{product.id}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {product.sku || 'N/A'}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-800">
                      ${product.price.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-bold ${product.available_quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {product.available_quantity}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">
                      {product.sold_quantity}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {getFulfillmentBadge(product.fulfillment)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {getStatusBadge(product.status)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <a
                        href={product.permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:text-blue-700 text-xl"
                      >
                        🔗
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          <div className="bg-gray-50 px-6 py-4 flex justify-between items-center border-t">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Mostrar:</span>
              <select
                value={itemsPerPage}
                onChange={(e) => setItemsPerPage(Number(e.target.value))}
                className="px-3 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-yellow-500"
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
                <option value={500}>500</option>
              </select>
              <span className="text-sm text-gray-600">por página</span>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => paginate(1)}
                disabled={currentPage === 1}
                className={`px-3 py-1 rounded ${
                  currentPage === 1
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-yellow-500 text-white hover:bg-yellow-600'
                }`}
              >
                ⏮️ Primera
              </button>
              
              <button
                onClick={() => paginate(currentPage - 1)}
                disabled={currentPage === 1}
                className={`px-3 py-1 rounded ${
                  currentPage === 1
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-yellow-500 text-white hover:bg-yellow-600'
                }`}
              >
                ◀️ Anterior
              </button>

              <span className="px-4 py-1 bg-white border border-gray-300 rounded">
                Página {currentPage} de {totalPages}
              </span>

              <button
                onClick={() => paginate(currentPage + 1)}
                disabled={currentPage === totalPages}
                className={`px-3 py-1 rounded ${
                  currentPage === totalPages
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-yellow-500 text-white hover:bg-yellow-600'
                }`}
              >
                Siguiente ▶️
              </button>

              <button
                onClick={() => paginate(totalPages)}
                disabled={currentPage === totalPages}
                className={`px-3 py-1 rounded ${
                  currentPage === totalPages
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-yellow-500 text-white hover:bg-yellow-600'
                }`}
              >
                Última ⏭️
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
