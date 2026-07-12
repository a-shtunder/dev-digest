# Specs

Ця папка містить специфікації Spec-Driven Development (SDD), створені та підтримувані агентом
`spec-creator` (`.claude/agents/spec-creator.md`).

## Що сюди писати

Пиши спеку тільки для фічі чи зміни, яка справді потребує узгодженого опису — типово це щось, що
зачіпає декілька модулів (`server/`, `client/`, `reviewer-core/`, `e2e/`) або має нетривіальні edge
cases й acceptance criteria. Дрібна одномодульна зміна спеки зазвичай не потребує.

## Формат

- Файл: `SPEC-NN-<назва-фічі>.md`, `NN` — наскрізний номер (max існуючого + 1).
- Тіло — за шаблоном у `.claude/agents/spec-creator.md`.
- `Status` (`draft` / `approved` / `implemented`) міняється тільки після явного підтвердження людини.
- Спеки не заміщують одна одну — оновлюються на місці, кожна зміна фіксується в `## Changelog`.

## Хто пише

Тільки агент `spec-creator`. Не редагуй ці файли вручну без потреби — тримай Changelog чесним.

## Не плутати з `<module>/specs/`

`client/specs/`, `server/specs/`, `reviewer-core/specs/`, `e2e/specs/` — це інший, старіший тип
документа (технічний опис поточних flow: `review-flow.md`, `pages.md`, `grounding-spec.md`, e2e
`*.flow.json`), без `SPEC-NN`, без `Status`, без EARS. Це не SDD-спеки й `spec-creator` туди нічого
не пише — тільки читає як контекст.
