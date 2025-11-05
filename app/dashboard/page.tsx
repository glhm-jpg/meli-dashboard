'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';

interface Product {
  id: string;
  title: string;
  attributes: Array<{
    id: string;
    name: string;
    value_name: string;
  }>;
  available_quantity: number;
  status: string;
  price: number;
  last_updated: string;
  permalink: string;
  shipping: {
    mode: string;
    free_shipping: boolean;
    logistic_type: string | null;
  };
}

export default function Dashboard() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [paginatedProducts, setPaginatedProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [total, setTotal] = useState(0);
  const [salesBySKU, setSalesBySKU] = useState<{ [sku: string]: number }>({});
  const [loadingSales, setLoadingSales] = useState(false);
  
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [loadingMore, setLoadingMore] = useState(false);
  
  const [fulfillmentFilter, setFulfillmentFilter] = useState<string>('todos');
  const [statusFilter, setStatusFilter] = useState<string>('todos');

  useEffect(() => {
    fetchProducts();
    fetchSales();
  }, []);

  useEffect(() => {
    filterProducts();
  }, [searchTerm, products, fulfillmentFilter, statusFilter]);
  
  useEffect(() => {
    paginateProducts();
  }, [filteredProducts, currentPage, itemsPerPage]);

  const paginateProducts = () => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginated = filteredProducts.slice(startIndex, endIndex);
    setPaginatedProducts(paginated);
  };

  const fetchProducts = async () => {
    try {
      setLoading(true);
      
      const initialResponse = await fetch('/api/products?offset=0&limit=50');
      
      if (initialResponse.status === 401) {
        router.push('/');
        return;
      }

      if (!initialResponse.ok) {
        throw new Error('Error cargando productos');
      }

      const initialData = await initialResponse.json();
      const totalProducts = initialData.total;
      setTotal(totalProducts);
      
      const allProducts: Product[] = [...initialData.products];
      const batchSize = 50;
      const initialLoadLimit = 500;
      const initialBatches = Math.ceil(initialLoadLimit / batchSize);
      
      console.log(`📦 Cargando primeros ${initialLoadLimit} productos de ${totalProducts} totales...`);
      
      for (let i = 1; i < initialBatches; i++) {
        const offset = i * batchSize;
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const response = await fetch(`/api/products?offset=${offset}&limit=${batchSize}`);
        
        if (response.ok) {
          const data = await response.json();
          allProducts.push(...data.products);
          setLoadingMore(true);
        }
      }
      
      console.log(`✅ Primeros ${allProducts.length} productos cargados`);
      
      setProducts(allProducts);
      setFilteredProducts(allProducts);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const loadMoreProducts = async () => {
    try {
      setLoadingMore(true);
      
      const currentCount = products.length;
      const batchSize = 50;
      const loadMoreLimit = 500;
      const moreBatches = Math.ceil(loadMoreLimit / batchSize);
      
      console.log(`📦 Cargando ${loadMoreLimit} productos más desde offset ${currentCount}...`);
      
      const moreProducts: Product[] = [];
      
      for (let i = 0; i < moreBatches; i++) {
        const offset = currentCount + (i * batchSize);
        
        if (offset >= total) {
          console.log('✅ Todos los productos cargados');
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const response = await fetch(`/api/products?offset=${offset}&limit=${batchSize}`);
        
        if (response.ok) {
          const data = await response.json();
          moreProducts.push(...data.products);
        }
      }
      
      console.log(`✅ Cargados ${moreProducts.length} productos adicionales`);
      
      const updatedProducts = [...products, ...moreProducts];
      setProducts(updatedProducts);
      setFilteredProducts(updatedProducts);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando más productos');
    } finally {
      setLoadingMore(false);
    }
  };

  const fetchSales = async () => {
    try {
      setLoadingSales(true);
      const response = await fetch('/api/sales');
      
      if (response.ok) {
        const data = await response.json();
        setSalesBySKU(data.salesBySKU || {});
      }
    } catch (err) {
      console.error('Error cargando ventas:', err);
    } finally {
      setLoadingSales(false);
    }
  };

  const filterProducts = () => {
    let filtered = [...products];

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(product => {
        const sku = product.attributes.find(attr => attr.id === 'SELLER_SKU')?.value_name || '';
        return (
          product.title.toLowerCase().includes(term) ||
          product.id.toLowerCase().includes(term) ||
          sku.toLowerCase().includes(term)
        );
      });
    }

    if (fulfillmentFilter !== 'todos') {
      filtered = filtered.filter(product => {
        switch (fulfillmentFilter) {
          case 'full':
            return product.shipping.logistic_type === 'fulfillment';
          case 'flex':
            return product.shipping.logistic_type === 'xd_drop_off';
          case 'mercadoenvios':
            return product.shipping.mode === 'me2';
          case 'normal':
            return product.shipping.mode === 'not_specified' || 
                   (!product.shipping.logistic_type && product.shipping.mode !== 'me2');
          default:
            return true;
        }
      });
    }

    if (statusFilter !== 'todos') {
      filtered = filtered.filter(product => product.status === statusFilter);
    }

    setFilteredProducts(filtered);
    setCurrentPage(1);
  };

  const getFulfillmentType = (shipping: Product['shipping']): string => {
    if (shipping.logistic_type === 'fulfillment') {
      return '📦 Full';
    } else if (shipping.logistic_type === 'xd_drop_off') {
      return '⚡ Flex';
    } else if (shipping.mode === 'me2') {
      return '📮 Mercado Envíos';
    } else if (shipping.mode === 'not_specified') {
      return 'Normal';
    }
    return 'Desconocido';
  };

  const getStatusBadge = (status: string) => {
    const badges: { [key: string]: { color: string; label: string } } = {
      'active': { color: 'bg-green-100 text-green-700', label: '🟢 Activo' },
      'paused': { color: 'bg-yellow-100 text-yellow-700', label: '🟡 Pausado' },
      'closed': { color: 'bg-red-100 text-red-700', label: '🔴 Cerrado' },
      'under_review': { color: 'bg-blue-100 text-blue-700', label: '🔵 En revisión' },
      'inactive': { color: 'bg-gray-100 text-gray-700', label: '⚫ Inactivo' }
    };
    const badge = badges[status] || { color: 'bg-gray-100 text-gray-700', label: status };
    return <span className={`px-2 py-1 text-xs rounded ${badge.color}`}>{badge.label}</span>;
  };

  const exportToExcel = () => {
    const dataToExport = filteredProducts.map(product => {
      const sku = product.attributes.find(attr => attr.id === 'SELLER_SKU')?.value_name || 'N/A';
      const sales60d = salesBySKU[sku] || 0;
      
      return {
        'ID': product.id,
        'Título': product.title,
        'SKU': sku,
        'Precio': product.price,
        'Stock': product.available_quantity,
        'Ventas 60d': sales60d,
        'Fulfillment': getFulfillmentType(product.shipping),
        'Estado': product.status,
        'Enlace': product.permalink
      };
    });

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Productos');
    XLSX.writeFile(wb, `productos_ml_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleLogout = () => {
    document.cookie = 'meli_access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    router.push('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-yellow-400 via-yellow-300 to-blue-500 flex items-center justify-center">
        <div className="bg-white p-8 rounded-xl shadow-2xl">
          <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-yellow-500 mx-auto mb-4"></div>
          <p className="text-xl font-semibold text-gray-700">Cargando productos...</p>
          <p className="text-sm text-gray-500 mt-2">Primeros 500 productos (10 segundos)</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-yellow-400 via-yellow-300 to-blue-500 flex items-center justify-center">
        <div className="bg-white p-8 rounded-xl shadow-2xl max-w-md">
          <p className="text-red-600 font-semibold">Error: {error}</p>
          <button
            onClick={() => router.push('/')}
            className="mt-4 bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-2 px-4 rounded"
          >
            Volver al inicio
          </button>
        </div>
      </div>
    );
  }

  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);

  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-400 via-yellow-300 to-blue-500 p-4">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-xl shadow-xl p-6 mb-6">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-gray-800">📊 Dashboard Mercado Libre</h1>
            <button
              onClick={handleLogout}
              className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg"
            >
              Cerrar Sesión
            </button>
          </div>

          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-blue-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600">Productos Cargados</p>
              <p className="text-2xl font-bold text-blue-600">{products.length} / {total}</p>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600">Mostrando</p>
              <p className="text-2xl font-bold text-green-600">{filteredProducts.length}</p>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600">Página</p>
              <p className="text-2xl font-bold text-purple-600">{currentPage} / {totalPages}</p>
            </div>
            <div className="bg-yellow-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600">Por Página</p>
              <p className="text-2xl font-bold text-yellow-600">{itemsPerPage}</p>
            </div>
          </div>

          <div className="flex gap-4 mb-4 flex-wrap">
            <input
              type="text"
              placeholder="🔍 Buscar por título, ID o SKU..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 min-w-[200px] px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500"
            />
            
            <select
              value={fulfillmentFilter}
              onChange={(e) => setFulfillmentFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500"
            >
              <option value="todos">Todos los envíos</option>
              <option value="full">📦 Full</option>
              <option value="flex">⚡ Flex</option>
              <option value="mercadoenvios">📮 Mercado Envíos</option>
              <option value="normal">Normal</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500"
            >
              <option value="todos">Todos los estados</option>
              <option value="active">🟢 Activo</option>
              <option value="paused">🟡 Pausado</option>
              <option value="closed">🔴 Cerrado</option>
              <option value="under_review">🔵 En revisión</option>
              <option value="inactive">⚫ Inactivo</option>
            </select>

            <button
              onClick={exportToExcel}
              className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg whitespace-nowrap"
            >
              📥 Exportar Excel
            </button>

            {products.length < total && (
              <button
                onClick={loadMoreProducts}
                disabled={loadingMore}
                className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg whitespace-nowrap disabled:bg-gray-400"
              >
                {loadingMore ? '⏳ Cargando...' : `📦 Cargar más (${products.length}/${total})`}
              </button>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-yellow-500 text-white">
                <tr>
                  <th className="px-4 py-3 text-left">Producto</th>
                  <th className="px-4 py-3 text-left">SKU</th>
                  <th className="px-4 py-3 text-right">Precio</th>
                  <th className="px-4 py-3 text-center">Stock</th>
                  <th className="px-4 py-3 text-center">Ventas 60d</th>
                  <th className="px-4 py-3 text-center">Fulfillment</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                  <th className="px-4 py-3 text-center">Ver</th>
                </tr>
              </thead>
              <tbody>
                {paginatedProducts.map((product, index) => {
                  const sku = product.attributes.find(attr => attr.id === 'SELLER_SKU')?.value_name || 'N/A';
                  const sales60d = salesBySKU[sku] || 0;
                  
                  return (
                    <tr key={product.id} className={index % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-800">{product.title}</div>
                        <div className="text-xs text-gray-500">{product.id}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{sku}</td>
                      <td className="px-4 py-3 text-right font-semibold">${product.price.toLocaleString()}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-bold ${product.available_quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {product.available_quantity}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-bold ${sales60d > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                          {loadingSales ? '...' : sales60d}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-sm">{getFulfillmentType(product.shipping)}</td>
                      <td className="px-4 py-3 text-center">{getStatusBadge(product.status)}</td>
                      <td className="px-4 py-3 text-center">
                        <a
                          href={product.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-500 hover:text-blue-700"
                        >
                          🔗
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="bg-gray-50 px-6 py-4 flex justify-between items-center border-t">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Mostrar:</span>
              <select
                value={itemsPerPage}
                onChange={(e) => setItemsPerPage(Number(e.target.value))}
                className="px-3 py-1 border rounded"
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
              <span className="text-sm text-gray-600">por página</span>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className={`px-3 py-1 rounded ${currentPage === 1 ? 'bg-gray-200' : 'bg-yellow-500 text-white hover:bg-yellow-600'}`}
              >
                ⏮️
              </button>
              
              <button
                onClick={() => setCurrentPage(currentPage - 1)}
                disabled={currentPage === 1}
                className={`px-3 py-1 rounded ${currentPage === 1 ? 'bg-gray-200' : 'bg-yellow-500 text-white hover:bg-yellow-600'}`}
              >
                ◀️
              </button>

              <span className="px-4 py-1 bg-white border rounded">
                {currentPage} / {totalPages}
              </span>

              <button
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className={`px-3 py-1 rounded ${currentPage === totalPages ? 'bg-gray-200' : 'bg-yellow-500 text-white hover:bg-yellow-600'}`}
              >
                ▶️
              </button>

              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className={`px-3 py-1 rounded ${currentPage === totalPages ? 'bg-gray-200' : 'bg-yellow-500 text-white hover:bg-yellow-600'}`}
              >
                ⏭️
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
