/* CreateSkillModal — merges the accepted convention candidates into ONE editable
   skill (type=convention, source=extracted), then POSTs it. Matches the design:
   everything below the merged-from note is editable before saving. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Modal, FormField, TextInput, SelectInput, Textarea, Toggle, Button } from "@devdigest/ui";
import type { ConventionCandidate, SkillType } from "@devdigest/shared";
import { useCreateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { buildSkillBody, buildSkillDescription, buildSkillName, repoShortName } from "../helpers";

const TYPE_OPTIONS = [
  { value: "convention", label: "Convention" },
  { value: "rubric", label: "Rubric" },
  { value: "security", label: "Security" },
  { value: "custom", label: "Custom" },
];

const estimateTokens = (text: string) => Math.round(text.length / 4);

export function CreateSkillModal({
  repoFullName,
  accepted,
  onClose,
}: {
  repoFullName: string;
  accepted: ConventionCandidate[];
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const router = useRouter();
  const toast = useToast();
  const createSkill = useCreateSkill();

  const [name, setName] = React.useState(() => buildSkillName(repoFullName));
  const [description, setDescription] = React.useState(() =>
    buildSkillDescription(repoFullName, accepted.length),
  );
  const [type, setType] = React.useState<SkillType>("convention");
  const [enabled, setEnabled] = React.useState(true);
  const [body, setBody] = React.useState(() => buildSkillBody(repoFullName, accepted));
  const [error, setError] = React.useState<string | null>(null);

  const save = () => {
    setError(null);
    createSkill.mutate(
      { name, description, type, source: "extracted", body, enabled },
      {
        onSuccess: (skill) => {
          toast.success(`Skill created (v${skill.version})`);
          onClose();
          router.push(`/skills/${skill.id}?tab=config`);
        },
        onError: (err) => setError(err instanceof Error ? err.message : t("modal.createFailed")),
      },
    );
  };

  return (
    <Modal
      width={720}
      title={t("modal.title")}
      subtitle={<span className="mono">{buildSkillName(repoFullName)}</span>}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
          {error && (
            <span style={{ fontSize: 12.5, color: "var(--crit)", marginRight: "auto" }}>{error}</span>
          )}
          <Button kind="secondary" size="sm" onClick={onClose}>
            {t("modal.cancel")}
          </Button>
          <Button
            kind="primary"
            size="sm"
            icon="Sparkles"
            onClick={save}
            disabled={createSkill.isPending || !name.trim() || !body.trim()}
          >
            {createSkill.isPending ? t("modal.creating") : t("modal.create")}
          </Button>
        </div>
      }
    >
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>
        <div
          style={{
            display: "flex",
            gap: 10,
            padding: "12px 14px",
            background: "var(--accent-bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 13,
            color: "var(--text-secondary)",
          }}
        >
          {t("modal.mergedFrom", {
            count: accepted.length,
            repo: repoShortName(repoFullName),
          })}
        </div>

        <FormField label={t("modal.name")} required>
          <TextInput value={name} onChange={setName} />
        </FormField>

        <FormField label={t("modal.description")}>
          <TextInput value={description} onChange={setDescription} />
        </FormField>

        <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <FormField label={t("modal.type")}>
              <SelectInput
                value={type}
                onChange={(v) => setType(v as SkillType)}
                options={TYPE_OPTIONS}
              />
            </FormField>
          </div>
          <FormField label={t("modal.enabled")} hint={t("modal.enabledHint")}>
            <Toggle on={enabled} onChange={setEnabled} />
          </FormField>
        </div>

        <FormField
          label={t("modal.body")}
          required
          right={
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {t("modal.tokens", { count: estimateTokens(body) })}
            </span>
          }
        >
          <Textarea value={body} onChange={setBody} rows={14} mono />
        </FormField>
      </div>
    </Modal>
  );
}
