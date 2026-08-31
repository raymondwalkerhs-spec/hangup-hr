import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Tabs from "@radix-ui/react-tabs";
import { api } from "@/api/client";
import { useAppStatus } from "@/hooks/useAppStatus";
import { SectionHeader } from "@/ui/SectionHeader";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { RulesSectionEditor } from "./RulesSectionEditor";
import {
  canShowRulesCompanyTabs,
  resolveRulesCompany,
  rulesCompanyLabel,
  soleRulesCompany,
} from "./rulesAccess";
import styles from "./RulesPage.module.css";

type Section = { sectionKey: string; key?: string; title: string; content: string };

function sectionId(sec: Section) {
  return sec.sectionKey || sec.key || "";
}

export function RulesPage() {
  const qc = useQueryClient();
  const [company, setCompany] = useState<"hangup" | "hs2">("hangup");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const { user } = useAppStatus();
  const canEdit = user?.canEditRules === true;
  const showBothTabs = canShowRulesCompanyTabs(user);
  const activeCompany = resolveRulesCompany(company, user);

  useEffect(() => {
    if (showBothTabs) return;
    setCompany(soleRulesCompany(user));
    setEditingKey(null);
  }, [showBothTabs, user?.unit, user?.role, user?.canManageHs2Company]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["rules-content", activeCompany],
    queryFn: () =>
      api<{ company: string; sections: Section[] }>(`/rules-content?company=${activeCompany}`),
  });

  const save = useMutation({
    mutationFn: ({ key, content }: { key: string; content: string }) =>
      api(`/rules-content/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify({ company: activeCompany, content }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rules-content", activeCompany] });
      setEditingKey(null);
    },
  });

  const sections = data?.sections || [];
  const subtitle = useMemo(
    () => `${rulesCompanyLabel(activeCompany)} — Office policies and procedures`,
    [activeCompany],
  );

  return (
    <div className={styles.page}>
      <SectionHeader title="Company Rules" subtitle={subtitle} />

      {showBothTabs && (
        <Tabs.Root
          value={company}
          onValueChange={(v) => {
            setCompany(v as "hangup" | "hs2");
            setEditingKey(null);
          }}
        >
          <Tabs.List className={styles.tabs}>
            <Tabs.Trigger value="hangup" className={styles.tab}>Main Hangup</Tabs.Trigger>
            <Tabs.Trigger value="hs2" className={styles.tab}>HS-2</Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>
      )}

      {isLoading && <p className="muted">Loading rules…</p>}
      {error && <p style={{ color: "var(--err)" }}>{(error as Error).message}</p>}

      <div className={styles.rulesGrid}>
        {sections.map((sec) => {
          const id = sectionId(sec);
          const isEditing = canEdit && editingKey === id;
          return (
            <Card key={id} className={styles.ruleCard} id={`rule-${id}`}>
              <div className={styles.ruleHeader}>
                <h2 className={styles.ruleTitle}>{sec.title || id}</h2>
                {canEdit && (
                  <div className={styles.ruleActions}>
                    {isEditing ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => save.mutate({ key: id, content: draft })}
                          disabled={save.isPending}
                        >
                          {save.isPending ? "Saving…" : "Save"}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setEditingKey(null);
                            save.reset();
                          }}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setEditingKey(id);
                          setDraft(sec.content || "");
                          save.reset();
                        }}
                      >
                        Edit
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {isEditing && save.isError && (
                <p style={{ color: "var(--err)", margin: "0.35rem 0 0" }}>
                  {(save.error as Error).message}
                </p>
              )}
              <div className={styles.ruleBody}>
                {isEditing ? (
                  <RulesSectionEditor
                    key={id}
                    content={sec.content || ""}
                    onChange={setDraft}
                  />
                ) : (
                  <div
                    className={styles.preview}
                    dangerouslySetInnerHTML={{ __html: sec.content || "<em class='muted'>Empty</em>" }}
                  />
                )}
              </div>
            </Card>
          );
        })}
        {!sections.length && !isLoading && (
          <p className="muted">No rule sections found.</p>
        )}
      </div>

      {save.isError && <p style={{ color: "var(--err)" }}>{(save.error as Error).message}</p>}
    </div>
  );
}
