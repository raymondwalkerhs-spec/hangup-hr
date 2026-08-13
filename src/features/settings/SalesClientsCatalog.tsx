import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { FormField, FormGrid } from "@/ui/FormGrid";
import { StatusPill } from "@/ui/StatusPill";

const DEVICE_TYPES = [
  { id: "smartwatch", label: "Smartwatch" },
  { id: "bracelet", label: "Bracelet" },
  { id: "necklace", label: "Necklace" },
];

type Price = { id: string; label?: string; price?: number };
type Product = { id: string; label?: string; deviceType?: string; isFavored?: boolean; prices?: Price[] };
type Client = { id: string; name?: string; status?: string; statusMessage?: string; saleProgram?: string; products?: Product[] };

export function SalesClientsCatalog({
  company,
  canManageHs2,
}: {
  company: "hangup" | "hs2";
  canManageHs2?: boolean;
}) {
  const qc = useQueryClient();
  const [catalogCompany, setCatalogCompany] = useState(company);
  const [saleProgram, setSaleProgram] = useState<"mla" | "rpm">("mla");
  const [clientDlg, setClientDlg] = useState<Client | null | "new">(null);
  const [productDlg, setProductDlg] = useState<{ clientId: string; product?: Product } | null>(null);
  const [priceDlg, setPriceDlg] = useState<{ productId: string; price?: Price } | null>(null);

  const { data } = useQuery({
    queryKey: ["settings-clients-full", catalogCompany, saleProgram],
    queryFn: () => api<{ clients?: Client[] }>(`/sales-config/clients?company=${encodeURIComponent(catalogCompany)}&saleProgram=${saleProgram}`),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["settings-clients-full", catalogCompany, saleProgram] });

  const scoped = (p: string) =>
    catalogCompany === "hs2" ? `${p}${p.includes("?") ? "&" : "?"}company=hs2` : p;

  const saveClient = useMutation({
    mutationFn: (body: Record<string, unknown>) => {
      if (clientDlg && clientDlg !== "new" && clientDlg.id) {
        return api(scoped(`/sales-config/clients/${clientDlg.id}`), { method: "PATCH", body: JSON.stringify(body) });
      }
      return api(scoped("/sales-config/clients"), { method: "POST", body: JSON.stringify({ ...body, company: catalogCompany, saleProgram }) });
    },
    onSuccess: () => { refresh(); setClientDlg(null); },
  });

  const delClient = useMutation({
    mutationFn: (id: string) => api(scoped(`/sales-config/clients/${id}`), { method: "DELETE" }),
    onSuccess: refresh,
  });

  const saveProduct = useMutation({
    mutationFn: (body: Record<string, unknown>) => {
      if (productDlg?.product?.id) {
        return api(scoped(`/sales-config/products/${productDlg.product.id}`), { method: "PATCH", body: JSON.stringify(body) });
      }
      return api(scoped("/sales-config/products"), { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => { refresh(); setProductDlg(null); },
  });

  const delProduct = useMutation({
    mutationFn: (id: string) => api(scoped(`/sales-config/products/${id}`), { method: "DELETE" }),
    onSuccess: refresh,
  });

  const savePrice = useMutation({
    mutationFn: (body: Record<string, unknown>) => {
      if (priceDlg?.price?.id) {
        return api(scoped(`/sales-config/prices/${priceDlg.price.id}`), { method: "PATCH", body: JSON.stringify(body) });
      }
      return api(scoped("/sales-config/prices"), { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => { refresh(); setPriceDlg(null); },
  });

  const delPrice = useMutation({
    mutationFn: (id: string) => api(scoped(`/sales-config/prices/${id}`), { method: "DELETE" }),
    onSuccess: refresh,
  });

  const toggleFavor = useMutation({
    mutationFn: ({ product, clientId }: { product: Product; clientId: string }) =>
      api(scoped(`/sales-config/products/${product.id}`), {
        method: "PATCH",
        body: JSON.stringify({
          clientId,
          deviceType: product.deviceType,
          label: product.label,
          isFavored: !product.isFavored,
        }),
      }),
    onSuccess: refresh,
  });

  const importClients = useMutation({
    mutationFn: () => api("/sales-config/import-from-sales", { method: "POST", body: JSON.stringify({ company: catalogCompany }) }),
    onSuccess: refresh,
  });

  const clients = (data?.clients || []).filter((c) => (c.saleProgram || "mla") === saleProgram);

  return (
    <div>
      <p className="muted" style={{ margin: "0 0 0.75rem" }}>
        Clients for closers/TL/OP by sales program. MLA uses device + price tiers; RPM uses flat client names on submit.
      </p>
      <div style={{ display: "flex", gap: "0.35rem", marginBottom: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <span className="muted">Program:</span>
        {(["mla", "rpm"] as const).map((p) => (
          <Button key={p} size="sm" variant={saleProgram === p ? "primary" : "secondary"} onClick={() => setSaleProgram(p)}>
            {p.toUpperCase()}
          </Button>
        ))}
      </div>
      {canManageHs2 && (
        <div style={{ display: "flex", gap: "0.35rem", marginBottom: "0.75rem", alignItems: "center" }}>
          <span className="muted">Company:</span>
          <Button size="sm" variant={catalogCompany === "hangup" ? "primary" : "secondary"} onClick={() => setCatalogCompany("hangup")}>Main Hangup</Button>
          <Button size="sm" variant={catalogCompany === "hs2" ? "primary" : "secondary"} onClick={() => setCatalogCompany("hs2")}>HS-2</Button>
        </div>
      )}
      <div style={{ display: "flex", gap: "0.35rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        <Button size="sm" onClick={() => setClientDlg("new")}>Add {saleProgram.toUpperCase()} client</Button>
        {saleProgram === "mla" && (
          <Button size="sm" variant="secondary" onClick={() => importClients.mutate()}>Import from sales</Button>
        )}
      </div>

      {!clients.length && <p className="muted">No {saleProgram.toUpperCase()} clients yet.</p>}
      {clients.map((c) => (
        <div key={c.id} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "0.75rem", marginBottom: "0.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.35rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <strong>{c.name}</strong>
              <span className="muted" style={{ fontSize: "0.75rem" }}>{(c.saleProgram || saleProgram).toUpperCase()}</span>
              <StatusPill variant={c.status === "active" ? "ok" : c.status === "warn" ? "warn" : "muted"}>{c.status || "active"}</StatusPill>
            </div>
            <span style={{ display: "flex", gap: "0.25rem" }}>
              <Button size="sm" variant="secondary" onClick={() => setClientDlg(c)}>Edit</Button>
              {saleProgram === "mla" && (
                <>
                  <Button size="sm" onClick={() => setProductDlg({ clientId: c.id })}>Add device</Button>
                </>
              )}
              <Button size="sm" variant="danger" onClick={() => { if (confirm("Delete client and all devices?")) delClient.mutate(c.id); }}>Delete</Button>
            </span>
          </div>
          {c.statusMessage && <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>{c.statusMessage}</p>}
          {saleProgram === "mla" && (
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1rem", fontSize: "0.85rem" }}>
            {(c.products || []).length === 0 && <li className="muted">No devices</li>}
            {(c.products || []).map((p) => (
              <li key={p.id} style={{ marginBottom: "0.35rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "0.25rem" }}>
                  <span>{p.isFavored ? "★ " : ""}<strong>{p.label || p.deviceType}</strong> ({p.deviceType})</span>
                  <span style={{ display: "flex", gap: "0.25rem" }}>
                    <Button size="sm" variant="secondary" onClick={() => toggleFavor.mutate({ product: p, clientId: c.id })}>{p.isFavored ? "Unstar" : "★ Favor"}</Button>
                    <Button size="sm" variant="secondary" onClick={() => setProductDlg({ clientId: c.id, product: p })}>Edit</Button>
                    <Button size="sm" variant="danger" onClick={() => { if (confirm("Delete device?")) delProduct.mutate(p.id); }}>Delete</Button>
                    <Button size="sm" onClick={() => setPriceDlg({ productId: p.id })}>Add price</Button>
                  </span>
                </div>
                <ul className="muted" style={{ margin: "0.25rem 0 0 1rem" }}>
                  {(p.prices || []).map((pr) => (
                    <li key={pr.id} style={{ display: "flex", gap: "0.35rem", alignItems: "center", flexWrap: "wrap" }}>
                      {pr.label}: {Number(pr.price || 0).toLocaleString("en-EG")} EGP
                      <Button size="sm" variant="secondary" onClick={() => setPriceDlg({ productId: p.id, price: pr })}>Edit</Button>
                      <Button size="sm" variant="danger" onClick={() => { if (confirm("Delete price?")) delPrice.mutate(pr.id); }}>Delete</Button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          )}
        </div>
      ))}

      <ClientDialog
        open={clientDlg !== null}
        client={clientDlg === "new" ? null : clientDlg}
        saleProgram={saleProgram}
        onClose={() => setClientDlg(null)}
        onSave={(body) => saveClient.mutate(body)}
        pending={saveClient.isPending}
      />
      <ProductDialog
        open={!!productDlg}
        clientId={productDlg?.clientId || ""}
        product={productDlg?.product}
        onClose={() => setProductDlg(null)}
        onSave={(body) => saveProduct.mutate(body)}
        pending={saveProduct.isPending}
      />
      <PriceDialog
        open={!!priceDlg}
        productId={priceDlg?.productId || ""}
        price={priceDlg?.price}
        onClose={() => setPriceDlg(null)}
        onSave={(body) => savePrice.mutate(body)}
        pending={savePrice.isPending}
      />
    </div>
  );
}

function ClientDialog({
  open, client, saleProgram, onClose, onSave, pending,
}: {
  open: boolean;
  client: Client | null;
  saleProgram: "mla" | "rpm";
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState("active");
  const [statusMessage, setStatusMessage] = useState("");
  const [program, setProgram] = useState<"mla" | "rpm">(saleProgram);

  const reset = () => {
    setName(client?.name || "");
    setStatus(client?.status || "active");
    setStatusMessage(client?.statusMessage || "");
    setProgram((client?.saleProgram as "mla" | "rpm") || saleProgram);
  };

  useEffect(() => { if (open) reset(); }, [open, client, saleProgram]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={client ? "Edit client" : `Add ${saleProgram.toUpperCase()} client`}>
      <FormGrid>
        <FormField label="Name"><input value={name} onChange={(e) => setName(e.target.value)} required /></FormField>
        <FormField label="Sales program">
          <select value={program} onChange={(e) => setProgram(e.target.value as "mla" | "rpm")} disabled={!!client}>
            <option value="mla">MLA</option>
            <option value="rpm">RPM</option>
          </select>
        </FormField>
        <FormField label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
            <option value="hold">On hold</option>
            <option value="warn">Warn on submit</option>
          </select>
        </FormField>
        <FormField label="Status message" span="full">
          <textarea rows={2} value={statusMessage} onChange={(e) => setStatusMessage(e.target.value)} />
        </FormField>
        <Button onClick={() => onSave({ name, status, statusMessage, saleProgram: program })} disabled={!name.trim() || pending}>Save</Button>
      </FormGrid>
    </Dialog>
  );
}

function ProductDialog({
  open, clientId, product, onClose, onSave, pending,
}: {
  open: boolean;
  clientId: string;
  product?: Product;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [deviceType, setDeviceType] = useState("smartwatch");
  const [label, setLabel] = useState("");
  const [isFavored, setIsFavored] = useState(false);

  const reset = () => {
    setDeviceType(product?.deviceType || "smartwatch");
    setLabel(product?.label || "");
    setIsFavored(!!product?.isFavored);
  };

  useEffect(() => { if (open) reset(); }, [open, product]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={product ? "Edit device" : "Add device"}>
      <FormGrid>
        <FormField label="Device type">
          <select value={deviceType} onChange={(e) => setDeviceType(e.target.value)}>
            {DEVICE_TYPES.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </FormField>
        <FormField label="Label"><input value={label} onChange={(e) => setLabel(e.target.value)} /></FormField>
        <FormField label="Favored">
          <label><input type="checkbox" checked={isFavored} onChange={(e) => setIsFavored(e.target.checked)} /> Show ★ in sale form</label>
        </FormField>
        <Button onClick={() => onSave({ clientId, deviceType, label, isFavored })} disabled={pending}>Save</Button>
      </FormGrid>
    </Dialog>
  );
}

function PriceDialog({
  open, productId, price, onClose, onSave, pending,
}: {
  open: boolean;
  productId: string;
  price?: Price;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");

  const reset = () => {
    setLabel(price?.label || "Standard");
    setAmount(price?.price != null ? String(price.price) : "0");
  };

  useEffect(() => { if (open) reset(); }, [open, price]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={price ? "Edit price tier" : "Add price tier"}>
      <FormGrid>
        <FormField label="Label"><input value={label} onChange={(e) => setLabel(e.target.value)} required /></FormField>
        <FormField label="Price (EGP)"><input type="number" min={0} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} /></FormField>
        <Button onClick={() => onSave({ productId, label, price: Number(amount) || 0 })} disabled={!label.trim() || pending}>Save</Button>
      </FormGrid>
    </Dialog>
  );
}
