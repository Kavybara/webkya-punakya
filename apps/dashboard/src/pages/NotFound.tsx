import { Link } from "react-router-dom";
import { Button } from "../components/base/Button";
import { Card, CardBody } from "../components/base/Card";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-cream px-4">
      <Card className="max-w-md">
        <CardBody className="text-center">
          <h1 className="text-2xl font-semibold text-slate-900">404</h1>
          <p className="mt-2 text-sm text-slate-500">Halaman tidak ditemukan.</p>
          <Link to="/" className="mt-5 inline-block">
            <Button>Kembali</Button>
          </Link>
        </CardBody>
      </Card>
    </main>
  );
}
