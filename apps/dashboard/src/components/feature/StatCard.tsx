import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";
import { Card, CardBody } from "../base/Card";

export function StatCard({
  icon: Icon,
  label,
  value,
  helper,
}: {
  icon: ComponentType<LucideProps>;
  label: string;
  value: string | number;
  helper?: string;
}) {
  return (
    <Card>
      <CardBody className="flex items-center gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 text-red-600">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xl font-semibold text-slate-900">{value}</div>
          <div className="text-sm text-slate-500">{label}</div>
          {helper ? <div className="mt-1 text-xs text-slate-400">{helper}</div> : null}
        </div>
      </CardBody>
    </Card>
  );
}
