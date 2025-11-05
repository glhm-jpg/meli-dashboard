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
  
  // Estados para paginación
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [loadingMore, setLoadingMore] = useState(false);
  
  // Estados para filtros
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
      
      // Primero obtenemos el total para saber cuántos productos hay
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
      
      // Cargar todos los productos en batches de 50
      const allProducts: Product[] = [...initialData.products];
      const batchSize = 50;
      
      // Calcular cuántos batches necesitamos
      const totalBatches = Math.ceil(totalProducts / batchSize);
      
      // Cargar el resto de los batches
      for (let i = 1; i < totalBatches; i++) {
        const offset = i * batchSize;
        const response = await fetch(`/api/products?offset=${offset}&limit=${batchSize}`);
        
        if (response.ok) {
          const data = await response.json();
          allProducts.push(...data.products);
          
          // Actualizar progreso
          setLoadingMore(true);
        }
      }
      
      setProducts(allProducts);
      setFilteredProducts(allProducts);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
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
      // No mostramos error al usuario, solo en consola
    } finally {
      setLoadingSales(false);
    }
  };

  const filterProducts = () => {
    let filtered = products;
    
    // Filtro por búsqueda de texto
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(product => {
        const sku = getSellerSKU(product);
        return (
          product.title.toLowerCase().includes(term) ||
          product.id.toLowerCase().includes(term) ||
          (sku !== '-' && sku.toLowerCase().includes(term))
        );
      });
    }
    
    // Filtro por tipo de fulfillment
    if (fulfillmentFilter !== 'todos') {
      filtered = filtered.filter(product => {
        switch (fulfillmentFilter) {
          case 'full':
            return product.shipping.logistic_type === 'fulfillment';
          case 'flex':
            return product.shipping.logistic_type === 'xd_drop_off';
          case 'me':
            return product.shipping.mode === 'me2';
          case 'normal':
            return product.shipping.mode === 'not_specified' || 
                   (!product.shipping.logistic_type && product.shipping.mode !== 'me2');
          default:
            return true;
        }
      });
    }
    
    // Filtro por estado de publicación
    if (statusFilter !== 'todos') {
      filtered = filtered.filter(product => product.status === statusFilter);
    }
    
    setFilteredProducts(filtered);
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleItemsPerPageChange = (newLimit: number) => {
    setItemsPerPage(newLimit);
    setCurrentPage(1);
  };

  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, filteredProducts.length);

  const getSellerSKU = (product: Product): string => {
    if (!product.attributes || product.attributes.length === 0) {
      return '-';
    }
    
    const skuAttribute = product.attributes.find(attr => attr.id === 'SELLER_SKU');
    return skuAttribute ? skuAttribute.value_name : '-';
  };

  const getSalesBySKU = (sku: string): number => {
    if (sku === '-') return 0;
    return salesBySKU[sku] || 0;
  };

  const getStockStatus = (quantity: number): { label: string; color: string } => {
    if (quantity <= 5) {
      return { label: 'Stock bajo', color: 'bg-yellow-100 text-yellow-800' };
    }
    return { label: 'Stock normal', color: 'bg-green-100 text-green-800' };
  };

  const getPublicationStatus = (status: string): { label: string; color: string } => {
    switch (status) {
      case 'active':
        return { label: '🟢 Activo', color: 'bg-green-100 text-green-800' };
      case 'paused':
        return { label: '🟡 Pausado', color: 'bg-yellow-100 text-yellow-800' };
      case 'closed':
        return { label: '🔴 Finalizado', color: 'bg-red-100 text-red-800' };
      case 'under_review':
        return { label: '🔵 En revisión', color: 'bg-blue-100 text-blue-800' };
      case 'inactive':
        return { label: '⚫ Inactivo', color: 'bg-gray-100 text-gray-800' };
      default:
        return { label: status, color: 'bg-gray-100 text-gray-800' };
    }
  };

  const getFulfillmentType = (shipping: Product['shipping']): string => {
    if (shipping.logistic_type === 'fulfillment') {
      return '📦 Full';
    } else if (shipping.logistic_type === 'xd_drop_off') {
      return '⚡ Flex';
    } else if (shipping.mode === 'me2') {
      return '🚚 Mercado Envíos';
    } else if (shipping.mode === 'not_specified') {
      return '📍 Sin envío';
    }
    return '📍 Normal';
  };

  const formatPrice = (price: number): string => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 0,
    }).format(price);
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const exportToExcel = () => {
    const dataToExport = filteredProducts.map(product => {
      const sku = getSellerSKU(product);
      return {
        'ID': product.id,
        'Producto': product.title,
        'SKU': sku,
        'Ventas 60d': getSalesBySKU(sku),
        'Stock': product.available_quantity,
        'Estado Stock': getStockStatus(product.available_quantity).label,
        'Estado Publicación': getPublicationStatus(product.status).label,
        'Fulfillment': getFulfillmentType(product.shipping),
        'Última Actualización': formatDate(product.last_updated),
        'Precio': product.price,
        'Link': product.permalink,
      };
    });

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Productos');

    const maxWidth = 50;
    const colWidths = Object.keys(dataToExport[0] || {}).map(key => {
      const maxLength = Math.max(
        key.length,
        ...dataToExport.map(row => String(row[key as keyof typeof row]).length)
      );
      return { wch: Math.min(maxLength + 2, maxWidth) };
    });
    ws['!cols'] = colWidths;

    // Nombre del archivo más descriptivo
    let fileName = `productos-mercadolibre`;
    if (searchTerm) {
      fileName += `-busqueda`;
    }
    if (fulfillmentFilter !== 'todos') {
      fileName += `-${fulfillmentFilter}`;
    }
    if (statusFilter !== 'todos') {
      fileName += `-${statusFilter}`;
    }
    fileName += `-${filteredProducts.length}-productos-${new Date().toISOString().split('T')[0]}.xlsx`;
    
    XLSX.writeFile(wb, fileName);
  };

  const handleLogout = async () => {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 font-semibold">Cargando todos los productos...</p>
          <p className="text-gray-500 text-sm mt-2">Esto puede tardar 15-30 segundos</p>
          {loadingMore && total > 0 && (
            <p className="text-blue-600 text-sm mt-2">
              Cargando... ({products.length} de {total})
            </p>
          )}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-md p-8 max-w-md w-full">
          <div className="text-red-600 text-center mb-4">
            <svg className="w-12 h-12 mx-auto mb-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>
            </svg>
            <h2 className="text-xl font-bold">Error</h2>
          </div>
          <p className="text-gray-600 text-center mb-4">{error}</p>
          <button
            onClick={handleLogout}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition duration-200"
          >
            Volver al inicio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-yellow-400 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-800">Dashboard Mercado Libre</h1>
                <p className="text-sm text-gray-500">Gestión de publicaciones</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="text-gray-600 hover:text-gray-800 font-medium text-sm flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search and Export */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
          <div className="flex flex-col gap-4">
            {/* Primera fila: Búsqueda y Exportar */}
            <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
              <div className="flex-1 w-full md:w-auto">
                <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-2">
                  Buscar producto:
                </label>
                <input
                  id="search"
                  type="text"
                  placeholder="Buscar por nombre, SKU o ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={exportToExcel}
                  disabled={filteredProducts.length === 0}
                  className="bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded-lg transition duration-200 flex items-center gap-2 whitespace-nowrap"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Exportar a Excel ({filteredProducts.length})
                </button>
              </div>
            </div>

            {/* Segunda fila: Filtros y selector de cantidad */}
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between border-t pt-4">
              <div className="flex flex-wrap items-center gap-4">
                {/* Selector de productos por página */}
                <div className="flex items-center gap-3">
                  <label htmlFor="itemsPerPage" className="text-sm font-medium text-gray-700 whitespace-nowrap">
                    Productos por página:
                  </label>
                  <select
                    id="itemsPerPage"
                    value={itemsPerPage}
                    onChange={(e) => handleItemsPerPageChange(Number(e.target.value))}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                  >
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                    <option value={500}>500</option>
                  </select>
                </div>
                
                {/* Filtro de Fulfillment */}
                <div className="flex items-center gap-3">
                  <label htmlFor="fulfillmentFilter" className="text-sm font-medium text-gray-700 whitespace-nowrap">
                    Fulfillment:
                  </label>
                  <select
                    id="fulfillmentFilter"
                    value={fulfillmentFilter}
                    onChange={(e) => setFulfillmentFilter(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white min-w-[160px]"
                  >
                    <option value="todos">Todos</option>
                    <option value="full">📦 Full</option>
                    <option value="flex">⚡ Flex</option>
                    <option value="me">🚚 Mercado Envíos</option>
                    <option value="normal">📍 Normal/Sin envío</option>
                  </select>
                </div>

                {/* Filtro de Estado de Publicación */}
                <div className="flex items-center gap-3">
                  <label htmlFor="statusFilter" className="text-sm font-medium text-gray-700 whitespace-nowrap">
                    Estado:
                  </label>
                  <select
                    id="statusFilter"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white min-w-[160px]"
                  >
                    <option value="todos">Todos</option>
                    <option value="active">🟢 Activo</option>
                    <option value="paused">🟡 Pausado</option>
                    <option value="closed">🔴 Finalizado</option>
                    <option value="under_review">🔵 En revisión</option>
                    <option value="inactive">⚫ Inactivo</option>
                  </select>
                </div>
              </div>
              
              <div className="text-sm text-gray-600">
                <span className="font-semibold">Total: {products.length.toLocaleString()}</span> productos cargados
                {(searchTerm || fulfillmentFilter !== 'todos' || statusFilter !== 'todos') && (
                  <span> • Mostrando <span className="font-semibold">{filteredProducts.length}</span> resultados • Página {currentPage} de {totalPages}</span>
                )}
                {!searchTerm && fulfillmentFilter === 'todos' && statusFilter === 'todos' && (
                  <span> • Viendo del <span className="font-semibold">{startItem}</span> al <span className="font-semibold">{endItem}</span></span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Products Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[450px] min-w-[450px]">
                    Producto
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                    SKU
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                    Ventas 60d
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                    Stock
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                    Estado Stock
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-36">
                    Estado Publicación
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                    Fulfillment
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-40">
                    Última actualización
                  </th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-28">
                    Precio
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {paginatedProducts.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-12 text-center">
                      <div className="text-gray-400">
                        <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                        </svg>
                        <p className="text-sm">No se encontraron productos</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedProducts.map((product) => {
                    const stockStatus = getStockStatus(product.available_quantity);
                    const pubStatus = getPublicationStatus(product.status);
                    const sku = getSellerSKU(product);
                    const sales60d = getSalesBySKU(sku);

                    return (
                      <tr key={product.id} className="hover:bg-gray-50">
                        <td className="px-4 py-4">
                          <div>
                            <a
                              href={product.permalink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 font-medium hover:underline"
                            >
                              {product.title}
                            </a>
                            <p className="text-xs text-gray-500 mt-1">{product.id}</p>
                          </div>
                        </td>
                        <td className="px-3 py-4 text-sm text-gray-900">
                          {sku}
                        </td>
                        <td className="px-3 py-4 text-center">
                          {loadingSales ? (
                            <div className="flex justify-center">
                              <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                            </div>
                          ) : (
                            <span className="text-sm font-semibold text-blue-600">
                              {sales60d > 0 ? `📊 ${sales60d}` : '-'}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-4 text-sm font-semibold text-gray-900 text-center">
                          {product.available_quantity}
                        </td>
                        <td className="px-3 py-4 text-center">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${stockStatus.color}`}>
                            {stockStatus.label}
                          </span>
                        </td>
                        <td className="px-3 py-4 text-center">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${pubStatus.color}`}>
                            {pubStatus.label}
                          </span>
                        </td>
                        <td className="px-3 py-4 text-sm text-gray-900 text-center">
                          {getFulfillmentType(product.shipping)}
                        </td>
                        <td className="px-3 py-4 text-xs text-gray-900">
                          {formatDate(product.last_updated)}
                        </td>
                        <td className="px-3 py-4 text-sm font-semibold text-green-600 text-right">
                          {formatPrice(product.price)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Paginación */}
        {totalPages > 1 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mt-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              {/* Información de página */}
              <div className="text-sm text-gray-600">
                Página <span className="font-semibold">{currentPage}</span> de <span className="font-semibold">{totalPages}</span>
              </div>

              {/* Botones de navegación */}
              <div className="flex items-center gap-2">
                {/* Primera página */}
                <button
                  onClick={() => handlePageChange(1)}
                  disabled={currentPage === 1}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed transition"
                  title="Primera página"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                  </svg>
                </button>

                {/* Página anterior */}
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed transition"
                >
                  Anterior
                </button>

                {/* Páginas numeradas */}
                <div className="hidden sm:flex items-center gap-1">
                  {/* Primera página siempre visible */}
                  {currentPage > 3 && (
                    <>
                      <button
                        onClick={() => handlePageChange(1)}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition"
                      >
                        1
                      </button>
                      {currentPage > 4 && <span className="px-2 text-gray-500">...</span>}
                    </>
                  )}

                  {/* Páginas cercanas a la actual */}
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const pageNum = currentPage <= 3 
                      ? i + 1 
                      : currentPage >= totalPages - 2
                        ? totalPages - 4 + i
                        : currentPage - 2 + i;
                    
                    if (pageNum < 1 || pageNum > totalPages) return null;
                    
                    return (
                      <button
                        key={pageNum}
                        onClick={() => handlePageChange(pageNum)}
                        className={`px-3 py-2 border rounded-lg text-sm font-medium transition ${
                          currentPage === pageNum
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}

                  {/* Última página siempre visible */}
                  {currentPage < totalPages - 2 && (
                    <>
                      {currentPage < totalPages - 3 && <span className="px-2 text-gray-500">...</span>}
                      <button
                        onClick={() => handlePageChange(totalPages)}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition"
                      >
                        {totalPages}
                      </button>
                    </>
                  )}
                </div>

                {/* Página siguiente */}
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed transition"
                >
                  Siguiente
                </button>

                {/* Última página */}
                <button
                  onClick={() => handlePageChange(totalPages)}
                  disabled={currentPage === totalPages}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed transition"
                  title="Última página"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                  </svg>
                </button>
              </div>

              {/* Input para ir a página específica */}
              <div className="flex items-center gap-2">
                <label htmlFor="goToPage" className="text-sm text-gray-600 whitespace-nowrap">
                  Ir a página:
                </label>
                <input
                  id="goToPage"
                  type="number"
                  min="1"
                  max={totalPages}
                  placeholder={currentPage.toString()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const page = parseInt((e.target as HTMLInputElement).value);
                      if (page >= 1 && page <= totalPages) {
                        handlePageChange(page);
                        (e.target as HTMLInputElement).value = '';
                      }
                    }
                  }}
                  className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
