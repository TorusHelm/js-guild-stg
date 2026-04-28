import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outlineBaseUrl = process.env.OUTLINE_BASE_URL || "https://outline.gospodaprogrammisty.ru";
const outlineApiKey = process.env.OUTLINE_API_KEY;
const outlineDocumentUrl =
  process.env.OUTLINE_DOCUMENT_URL ||
  "https://outline.gospodaprogrammisty.ru/doc/javascript-FxjTgSQD6R#h-sostav-uchastnikov";
const outlineDocumentId = process.env.OUTLINE_DOCUMENT_ID || "FxjTgSQD6R";
const outputDir = resolve(process.cwd(), "public/data");
const tableHint = "Гильдии -> javascript -> Состав участников";

if (!outlineApiKey) {
  throw new Error("OUTLINE_API_KEY is required");
}

async function outlineRequest(path, body) {
  const response = await fetch(`${outlineBaseUrl}/api/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${outlineApiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Outline API ${path} failed: ${response.status} ${text}`);
  }

  return response.json();
}

function normalizeEmail(value) {
  const email = value.trim().toLowerCase();
  return email.includes("@") ? email : "";
}

function parseMembersFromText(text) {
  const warnings = [];
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const members = [];
  const seenNames = new Set();
  const seenEmails = new Set();

  for (const line of lines) {
    const rowMatch = line.match(/^\|(.+)\|$/);
    if (!rowMatch) {
      continue;
    }

    const cells = rowMatch[1]
      .split("|")
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0);

    if (cells.length < 2) {
      continue;
    }

    const firstCell = cells[0].toLowerCase();
    const secondCell = cells[1].toLowerCase();

    if (
      firstCell === "№" ||
      firstCell === "#" ||
      firstCell === "n" ||
      secondCell.includes("фио")
    ) {
      continue;
    }

    if (cells.every((cell) => /^-+$/.test(cell.replace(/:/g, "")))) {
      continue;
    }

    const number = Number.parseInt(cells[0], 10);
    const fullName = cells[1];
    const email = normalizeEmail(cells[2] || "");

    if (!fullName) {
      warnings.push(`Пропущена строка без ФИО: ${line}`);
      continue;
    }

    const nameKey = fullName.toLowerCase();
    if (seenNames.has(nameKey)) {
      warnings.push(`Дубликат ФИО пропущен: ${fullName}`);
      continue;
    }

    if (email && seenEmails.has(email)) {
      warnings.push(`Дубликат email пропущен: ${email}`);
      continue;
    }

    seenNames.add(nameKey);
    if (email) {
      seenEmails.add(email);
    }

    members.push({
      number: Number.isNaN(number) ? null : number,
      fullName,
      email,
    });
  }

  if (!members.length) {
    warnings.push("Не удалось распарсить ни одного участника. Проверь формат таблицы в Outline.");
  }

  return { members, warnings };
}

async function main() {
  const documentInfo = await outlineRequest("documents.info", {
    id: outlineDocumentId,
  });

  const text =
    documentInfo?.data?.text ||
    documentInfo?.data?.content ||
    documentInfo?.data?.title ||
    "";

  const { members, warnings } = parseMembersFromText(text);
  const syncedAt = new Date().toISOString();

  const status = {
    source: {
      outlineBaseUrl,
      documentUrl: outlineDocumentUrl,
      tableHint,
    },
    syncedAt,
    memberCount: members.length,
    warnings,
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "members.json"), `${JSON.stringify(members, null, 2)}\n`);
  await writeFile(resolve(outputDir, "status.json"), `${JSON.stringify(status, null, 2)}\n`);

  console.log(`Synced ${members.length} members at ${syncedAt}`);
  if (warnings.length) {
    console.log(`Warnings: ${warnings.length}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
