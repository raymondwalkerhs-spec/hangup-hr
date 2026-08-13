import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { FormField } from "@/ui/FormGrid";
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
        <select
          required
          value={clientId}
          onChange={(e) => {
            const c = clients.find((x) => x.id === e.target.value);
            onChange({ clientId: e.target.value, productId: "", priceId: "", client: c?.name });
          }}
        >
          <option value="">Select client…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}{c.status === "hold" ? " (on hold)" : ""}</option>
          ))}
        </select>
      </FormField>
      <FormField label="Device / product">
        <select
          required
          value={productId}
          disabled={!clientId}
          onChange={(e) => {
            const p = products.find((x) => x.id === e.target.value);
            onChange({
              clientId,
              productId: e.target.value,
              priceId: "",
              client: client?.name,
              device: p?.deviceType || p?.label,
            });
          }}
        >
          <option value="">Select device…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.label || p.deviceType}</option>
          ))}
        </select>
      </FormField>
      <FormField label="Price tier">
        <select
          required
          value={priceId}
          disabled={!productId}
          onChange={(e) => {
            const pr = prices.find((x) => x.id === e.target.value);
            onChange({
              clientId,
              productId,
              priceId: e.target.value,
              client: client?.name,
              device: product?.deviceType || product?.label,
              price: pr?.price != null ? String(pr.price) : "",
            });
          }}
        >
          <option value="">Select price…</option>
          {prices.map((p) => (
            <option key={p.id} value={p.id}>{p.label || "Standard"} — {p.price} EGP</option>
          ))}
        </select>
      </FormField>
    </div>
  );
}
