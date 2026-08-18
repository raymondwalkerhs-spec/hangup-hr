import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { FormField } from "@/ui/FormGrid";
import { Select } from "@/ui/Select";
import type { SalesProgram } from "./sale-program";

type CatalogClient = {
  id: string;
  name?: string;
  status?: string;
  saleProgram?: string;
  products?: {
    id: string;
    deviceType?: string;
    label?: string;
    active?: boolean;
    prices?: { id: string; label?: string; price?: number; active?: boolean }[];
  }[];
};

export function SaleCatalogPicker({
  clientId,
  productId,
  priceId,
  saleProgram = "mla",
  onChange,
}: {
  clientId: string;
  productId: string;
  priceId: string;
  saleProgram?: SalesProgram;
  onChange: (patch: {
    clientId: string;
    productId: string;
    priceId: string;
    client?: string;
    device?: string;
    price?: string;
  }) => void;
}) {
  const { companyContext } = useCompanyScope();
  const companyQs = companyContext === "hs2" ? "&company=hs2" : "";

  const { data } = useQuery({
    queryKey: ["sales-config-catalog", companyContext, saleProgram],
    queryFn: () =>
      api<{ clients?: CatalogClient[] }>(
        `/sales-config/catalog?saleProgram=${encodeURIComponent(saleProgram)}${companyQs}`
      ),
  });

  const clients = (data?.clients || []).filter((c) => c.status !== "disabled");
  const client = clients.find((c) => c.id === clientId);
  const products = (client?.products || []).filter((p) => p.active !== false);
  const product = products.find((p) => p.id === productId);
  const prices = (product?.prices || []).filter((p) => p.active !== false);

  useEffect(() => {
    if (!clientId && clients.length === 1) {
      const c = clients[0];
      onChange({ clientId: c.id, productId: "", priceId: "", client: c.name });
    }
  }, [clients, clientId, onChange]);

  if (!clients.length) {
    return (
      <p className="muted" style={{ marginBottom: "1rem" }}>
        No {saleProgram.toUpperCase()} clients in catalog — ask RTM/Admin to configure clients in Settings.
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
      <FormField label="Client">
        <Select
          value={clientId}
          placeholder="Select client…"
          options={[
            { value: "", label: "Select client…" },
            ...clients.map((c) => ({
              value: c.id,
              label: `${c.name}${c.status === "hold" ? " (on hold)" : ""}`,
            })),
          ]}
          onChange={(v) => {
            const c = clients.find((x) => x.id === v);
            onChange({ clientId: v, productId: "", priceId: "", client: c?.name });
          }}
        />
      </FormField>
      <FormField label="Device / product">
        <Select
          value={productId}
          disabled={!clientId}
          placeholder="Select device…"
          options={[
            { value: "", label: "Select device…" },
            ...products.map((p) => ({ value: p.id, label: String(p.label || p.deviceType || p.id) })),
          ]}
          onChange={(v) => {
            const p = products.find((x) => x.id === v);
            onChange({
              clientId,
              productId: v,
              priceId: "",
              client: client?.name,
              device: p?.deviceType || p?.label,
            });
          }}
        />
      </FormField>
      <FormField label="Price tier">
        <Select
          value={priceId}
          disabled={!productId}
          placeholder="Select price…"
          options={[
            { value: "", label: "Select price…" },
            ...prices.map((p) => ({
              value: p.id,
              label: `${p.label || "Standard"} — ${p.price} EGP`,
            })),
          ]}
          onChange={(v) => {
            const pr = prices.find((x) => x.id === v);
            onChange({
              clientId,
              productId,
              priceId: v,
              client: client?.name,
              device: product?.deviceType || product?.label,
              price: pr?.price != null ? String(pr.price) : "",
            });
          }}
        />
      </FormField>
    </div>
  );
}
