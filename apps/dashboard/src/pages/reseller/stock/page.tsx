import { useEffect, useState } from "react";
import { Badge } from "../../../components/base/Badge";
import { Card, CardBody, CardHeader, CardTitle } from "../../../components/base/Card";
import { DashboardLayout } from "../../../components/feature/DashboardLayout";
import { api, subscribeRealtime, type ApiStockItem, type CatalogProduct } from "../../../lib/api";

export default function ResellerStockPage() {
  const [stockItems, setStockItems] = useState<ApiStockItem[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);

  async function loadData() {
    const [productRows, stockRows] = await Promise.all([api.catalogAll(), api.stock()]);
    setProducts(productRows);
    setStockItems(stockRows);
  }

  useEffect(() => {
    loadData().catch(console.error);
    return subscribeRealtime(() => {
      loadData().catch(console.error);
    });
  }, []);

  return (
    <DashboardLayout role="reseller" title="Stock View">
      <Card>
        <CardHeader>
          <CardTitle>Read-only stock</CardTitle>
          <p className="mt-1 text-sm text-slate-500">Reseller hanya melihat stok tersedia tanpa akses edit.</p>
        </CardHeader>
        <CardBody className="max-h-[calc(100vh-260px)] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-20 bg-white text-xs uppercase text-slate-400 shadow-sm shadow-slate-950/5">
              <tr>
                <th className="px-3 py-3">Produk</th>
                <th className="px-3 py-3">Variant</th>
                <th className="px-3 py-3">Ready</th>
                <th className="px-3 py-3">Profile/PIN</th>
              </tr>
            </thead>
            <tbody>
              {stockItems.map((item) => {
                const product = products.find((row) => row.id === item.productId);
                const variant = product?.variants.find((row) => row.id === item.variantId);
                return (
                  <tr key={item.id} className="border-t border-gray-100">
                    <td className="px-3 py-3">{product?.name}</td>
                    <td className="px-3 py-3">{variant?.code}</td>
                    <td className="px-3 py-3">
                      <Badge variant="emerald">{Number(item.availableCount || 0)} akun</Badge>
                    </td>
                    <td className="px-3 py-3 text-slate-500">{product?.needsProfile || product?.needsPin ? "Required" : "Not required"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </DashboardLayout>
  );
}
