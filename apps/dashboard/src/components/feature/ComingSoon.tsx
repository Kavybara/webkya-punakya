import { Card, CardBody } from "../base/Card";

export function ComingSoon({ title = "Coming soon" }: { title?: string }) {
  return (
    <Card>
      <CardBody className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
          <i className="ri-time-line text-xl" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-slate-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-500">Fitur ini siap disambungkan ke data real.</p>
      </CardBody>
    </Card>
  );
}
