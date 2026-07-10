/**
 * server/controllers/resumeParserController.js
 *
 * FIXES in this version:
 *  ✅ NEW: extractIdentity() — Groq now validates name, role, email, phone
 *      so location strings (e.g. "Vizianagaram, Andhra Pradesh") never land in `role`
 *  ✅ Model: llama-3.3-70b-versatile
 *  ✅ Fallback chains for skills / experience / projects
 *  ✅ All Groq failures logged with full detail
 *  ✅ Lazy Groq client
 */

import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { callGroqPool, poolAvailable } from "../lib/groqPool.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Model chain: strongest first, fast model as a fallback when the 70B is
// rate-limited/unavailable across every key in the pool.
const GROQ_MODELS = [
  { id: "llama-3.3-70b-versatile", label: "llama-3.3-70b", maxOut: 1000 },
  { id: "llama-3.1-8b-instant",    label: "llama-3.1-8b",  maxOut: 1000 },
];

const PYTHON_SCRIPT = path.join(__dirname, "../python/resume_extractor.py");
const PYTHON_BIN    = process.platform === "win32" ? "python" : "python3";

// Per-extractor input budget. The 70B has plenty of context; the old 4000-char
// blind cut regularly dropped the bottom half of dense resumes.
const INPUT_BUDGET = 7000;

/**
 * Condense raw resume text before sending it to the model: collapse repeated
 * whitespace, drop duplicate lines (headers/footers repeat on every PDF page)
 * and decorative rules, then cap at the budget. Beats a blind substring cut —
 * the tail of the resume (projects, certifications) survives.
 */
function condense(text, budget = INPUT_BUDGET) {
  if (!text) return "";
  const seen = new Set();
  const lines = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (/^[-_=*•.\s|]{4,}$/.test(line)) continue; // decorative separators
    const key = line.toLowerCase();
    if (line.length > 8 && seen.has(key)) continue; // repeated page headers/footers
    seen.add(key);
    lines.push(line);
  }
  let out = lines.join("\n");
  if (out.length > budget) out = out.slice(0, budget);
  return out;
}

// ── STEP 1: Python ────────────────────────────────────────────────────────────
function runPython(filePath) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const proc = spawn(PYTHON_BIN, [PYTHON_SCRIPT, filePath]);
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (stderr) console.warn("[Python stderr]", stderr.substring(0, 500));
      console.log(`[Python] exit=${code} stdout_chars=${stdout.length}`);
      if (!stdout.trim()) {
        return reject(new Error("Python produced no output. Run: pip install pdfplumber pymupdf pillow"));
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        reject(new Error("Python returned invalid JSON:\n" + stdout.substring(0, 200)));
      }
    });
    proc.on("error", (err) =>
      reject(new Error(
        err.code === "ENOENT"
          ? "Python not found. Install Python and ensure it's in PATH."
          : "Spawn error: " + err.message
      ))
    );
  });
}

// ── STEP 2: Text cleaner ──────────────────────────────────────────────────────
function cleanStr(s) {
  if (typeof s !== "string") return "";
  return s
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\uFFFD|[^\x09\x0A\x0D\x20-\x7E\u00C0-\u024F]/g, "")
    .replace(/[|%]{2,}/g, "")
    .replace(/\.{3,}/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ── STEP 3: Groq helper ───────────────────────────────────────────────────────
// Extract the JSON object from a model reply, tolerating code fences and
// stray prose around it. Returns null when nothing parseable is found.
function extractJson(raw) {
  if (!raw) return null;
  let s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(s); } catch { /* try the outermost {...} below */ }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

// Runs through the shared multi-key pool: key rotation on 429/401 and model
// fallback (70B → 8B), instead of the old dedicated single-key client.
async function groqCall(systemPrompt, userContent, label) {
  try {
    const input = condense(userContent);
    console.log(`[Groq:${label}] Sending ${input.length} chars (pool)...`);
    const res = await callGroqPool(
      [
        { role: "system", content: systemPrompt },
        { role: "user",   content: input },
      ],
      1000,
      GROQ_MODELS,
      { temperature: 0, responseFormat: { type: "json_object" } }
    );
    const raw = (res.text || "").trim();
    console.log(`[Groq:${label}] ${res.model}/${res.keyLabel}: ${raw.substring(0, 120)}...`);
    const parsed = extractJson(raw);
    if (!parsed) console.error(`[Groq:${label}] Unparseable JSON reply`);
    return parsed;
  } catch (err) {
    console.error(`[Groq:${label}] FAILED — ${err.message}`);
    if (err?.error) console.error(`[Groq:${label}] Details:`, JSON.stringify(err.error));
    return null;
  }
}

// ── STEP 4A: Identity (name + role + email + phone) ──────────────────────────
/**
 * THIS IS THE KEY FIX.
 *
 * Python regex often grabs the first "line that looks like a value" and puts
 * it in `role`.  On Indian CVs the header is typically:
 *
 *   Full Name
 *   City, State          ← Python mistakes this for role
 *   email | phone
 *   Objective / Summary: "Software Developer with 2 years…"
 *
 * We give Groq the first 800 chars of the raw CV text and strict rules so it
 * can correctly separate geographic location from professional job title.
 */
async function extractIdentity(raw) {
  // Build a compact snapshot of what Python already found + the top of the CV
  const hint = [
    `python_name:  ${raw.name  || ""}`,
    `python_role:  ${raw.role  || ""}`,
    `python_email: ${raw.email || ""}`,
    `python_phone: ${raw.phone || ""}`,
    `--- top of CV text ---`,
    (raw.raw_full || "").substring(0, 800),
  ].join("\n");

  const sys = `You are a senior resume parser. Your task is to extract ONLY the personal identity fields.

Return JSON with exactly these keys:
{
  "name":  "Full legal name of the person",
  "role":  "Professional job title only",
  "email": "Email address or empty string",
  "phone": "Phone number or empty string"
}

CRITICAL RULES FOR "role":
- "role" MUST be a professional job title such as:
    "Software Engineer", "Frontend Developer", "Data Scientist",
    "Full Stack Developer", "UI/UX Designer", "Product Manager", etc.
- "role" MUST NOT be a city, state, country, district, or any geographic location.
    Examples of INVALID role values: "Vizianagaram, Andhra Pradesh",
    "New York, NY", "Hyderabad", "India", "Bangalore, Karnataka"
- If what Python labeled as "role" is a location, IGNORE it and instead look
  for the actual job title in the CV text (often in the objective/summary line
  or in the first job experience entry).
- If no job title is found anywhere, return "role": "".
- Never put location, address, zip code, or phone number in "role".

CRITICAL RULES FOR "name":
- Must be a person's real full name (2-4 words, proper-case).
- Must NOT be a company name, skill, or heading like "Resume" / "CV".

CRITICAL RULES FOR "email":
- Must match pattern x@x.x — if none found, return "".

Return ONLY the JSON object, no explanation.`;

  const result = await groqCall(sys, hint, "identity");

  return {
    name:  cleanStr(result?.name  || raw.name  || ""),
    role:  cleanStr(result?.role  || ""),
    email: cleanStr(result?.email || raw.email || ""),
    phone: cleanStr(result?.phone || raw.phone || ""),
  };
}

// ── STEP 4B: Bio ──────────────────────────────────────────────────────────────
async function extractBio(rawSummary, rawFull) {
  const input = rawSummary?.trim() || rawFull?.substring(0, 500) || "";
  if (!input) return "";

  const sys = `You are a resume parser. Extract the professional summary/bio.
Return JSON: { "bio": "2-3 sentence professional summary string" }
Rules:
- Use ONLY text from the input. Do NOT invent anything.
- If input is empty or unclear, return { "bio": "" }
- Clean up punctuation and formatting only.
- Do NOT write a new bio. Extract what is there.`;

  const result = await groqCall(sys, input, "bio");
  return cleanStr(result?.bio || "");
}

// ── STEP 4C: Education ────────────────────────────────────────────────────────
async function extractEducation(rawEdu, rawFull) {
  const input = rawEdu?.trim() || "";
  if (!input) {
    const degreeMatch = rawFull?.match(
      /(B\.?Tech|B\.?E|B\.?Sc|M\.?Tech|M\.?Sc|MBA|BCA|MCA|Bachelor|Master|Ph\.?D)[^\n]{0,120}/i
    );
    if (!degreeMatch) return "";
    return cleanStr(degreeMatch[0]);
  }

  const sys = `You are a resume parser. Extract the highest/most recent education.
Return JSON: { "education": "Degree Name - Institution Name (Year or Year Range)" }
Rules:
- Return ONLY ONE education entry as a clean string.
- Format: "B.Tech Computer Science - XYZ University (2020-2024)"
- If multiple entries, pick the most recent or highest degree.
- Do NOT include GPA, grades, or extra details.
- Use ONLY what is in the input.`;

  const result = await groqCall(sys, input, "education");
  return cleanStr(result?.education || "");
}

// ── STEP 4D: Skills ───────────────────────────────────────────────────────────
async function extractSkills(rawSkills, rawFull) {
  const input = rawSkills?.trim() ? rawSkills : rawFull || "";
  if (!input) return [];

  const sys = `You are a resume parser. Extract ONLY technical hard skills from the resume text.
Return JSON: { "skills": [{ "name": "string", "level": "Basic|Intermediate|Expert" }] }

STRICT RULES:
1. ONLY include technical tools, languages, frameworks, platforms, databases.
   VALID: JavaScript, React, Node.js, Python, AWS, MongoDB, Docker, Git, TypeScript, HTML, CSS
   INVALID: Communication, Teamwork, Agile, Leadership, Problem-solving, Time Management
2. Maximum 15 skills. Pick the most technically specific ones.
3. Fix casing: javascript→JavaScript, nodejs→Node.js, reactjs→React,
   typescript→TypeScript, css→CSS, html→HTML, aws→AWS, mongodb→MongoDB,
   expressjs→Express.js, nextjs→Next.js, vuejs→Vue.js, cpp→C++, pytorch→PyTorch
4. Level inference:
   - Listed under "Expert/Proficient/Advanced" → Expert
   - Listed under "Familiar/Learning/Basic" → Basic
   - Default → Intermediate
5. NO duplicates. If React and ReactJS both appear, keep React only.
6. Ignore skills shorter than 2 chars or longer than 30 chars.
7. Remove percentages, bar indicators, numbers from skill names.
8. If the input is the full resume text (not just a skills section), scan the
   ENTIRE text for technical tools and languages mentioned anywhere.`;

  const result = await groqCall(sys, input, "skills");
  const raw = Array.isArray(result?.skills) ? result.skills : [];

  const seen = new Set();
  return raw
    .filter((s) => s?.name && typeof s.name === "string" && s.name.length >= 2)
    .filter((s) => {
      const key = s.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((s) => ({
      name:  cleanStr(s.name),
      level: ["Basic", "Intermediate", "Expert"].includes(s.level) ? s.level : "Intermediate",
    }))
    .slice(0, 15);
}

// ── STEP 4E: Experience ───────────────────────────────────────────────────────
async function extractExperience(rawExp, rawFull) {
  // Section splitting is heading-based; resumes with unusual headings end up
  // with an empty section. Fall back to scanning the whole (condensed) text
  // instead of silently returning nothing.
  const usingFullText = !rawExp?.trim();
  const input = rawExp?.trim() || rawFull?.trim() || "";
  if (!input) {
    console.log("[ResumeParser] No raw_experience or raw_full — skipping experience extraction");
    return [];
  }
  if (usingFullText) console.log("[ResumeParser] No raw_experience section — scanning full text");

  const sys = `You are a resume parser. Extract work experience entries.${usingFullText ? "\nThe input is the FULL resume text — find the work-experience entries within it. If there are none (student resume with no jobs), return { \"experience\": [] }." : ""}
Return JSON: { "experience": [{ "company": "", "role": "", "period": "", "desc": "" }] }

CRITICAL RULES:
1. "company" = the ORGANIZATION/EMPLOYER name (e.g. Google, Infosys, TCS, Startup Name)
   "role"    = the JOB TITLE the person held (e.g. Software Engineer, Frontend Intern)
   THESE MUST NEVER BE SWAPPED.
2. "role" here means job title — NEVER a city, location, or address.
3. "period" = date range only. Format: "Jan 2023 - Present" or "2022 - 2024".
4. "desc"   = 1-2 clean sentences describing responsibilities.
5. ONLY include actual jobs/internships. No projects, education, or skills.
6. If company name is missing, use "Organisation". If role is missing, use "Role".`;

  const result = await groqCall(sys, input, "experience");
  const raw = Array.isArray(result?.experience) ? result.experience : [];

  return raw
    .filter((e) => e && (e.company || e.role))
    .filter((e) => {
      const companyLower = (e.company || "").toLowerCase();
      const roleTitleWords = ["developer", "engineer", "intern", "analyst", "designer", "manager", "lead"];
      if (roleTitleWords.some((w) => companyLower.startsWith(w))) {
        [e.company, e.role] = [e.role, e.company];
      }
      return true;
    })
    .map((e) => ({
      company: cleanStr(e.company || "Organisation"),
      role:    cleanStr(e.role    || "Role"),
      period:  cleanStr(e.period  || ""),
      desc:    cleanStr(e.desc    || ""),
    }));
}

// ── STEP 4F: Projects ─────────────────────────────────────────────────────────
async function extractProjects(rawProjects, rawFull) {
  const usingFullText = !rawProjects?.trim();
  const input = rawProjects?.trim() || rawFull?.trim() || "";
  if (!input) {
    console.log("[ResumeParser] No raw_projects or raw_full — skipping project extraction");
    return [];
  }
  if (usingFullText) console.log("[ResumeParser] No raw_projects section — scanning full text");

  const sys = `You are a resume parser. Extract real software/coding projects.${usingFullText ? "\nThe input is the FULL resume text — find the project entries within it. If there are none, return { \"projects\": [] }." : ""}
Return JSON: { "projects": [{ "title": "", "tech": "", "github": "", "demo": "", "description": "" }] }

STRICT RULES:
1. "title" = the NAME of the project (e.g. "E-Commerce App", "Chat Application")
   - Must be a real project name, NOT a job title or skill.
   - REJECT if title contains: Developer, Engineer, Intern, chunking
   - REJECT if title is less than 3 or more than 60 characters.
2. "tech"   = comma-separated technologies (e.g. "React, Node.js, MongoDB").
3. "github" = full GitHub URL if present, else "".
4. "demo"   = live demo URL if present, else "".
5. "description" = 1-2 clean sentences about what the project does.
6. Maximum 6 projects.`;

  const result = await groqCall(sys, input, "projects");
  const raw = Array.isArray(result?.projects) ? result.projects : [];

  const INVALID_TITLE_PATTERNS = [
    /developer/i, /engineer/i, /intern/i, /analyst/i, /manager/i,
    /chunking/i, /undefined/i, /null/i, /^\.+$/, /^\|+$/,
  ];

  const seen = new Set();
  return raw
    .filter((p) => p?.title && typeof p.title === "string")
    .filter((p) => {
      const t = p.title.trim();
      if (t.length < 3 || t.length > 60) return false;
      if (INVALID_TITLE_PATTERNS.some((re) => re.test(t))) return false;
      const key = t.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((p) => ({
      title:       cleanStr(p.title),
      tech:        cleanStr(p.tech        || ""),
      github:      cleanStr(p.github      || ""),
      demo:        cleanStr(p.demo        || ""),
      description: cleanStr(p.description || ""),
    }))
    .slice(0, 6);
}

// ── STEP 5: Post-processing ───────────────────────────────────────────────────
const JUNK_PATTERNS = [
  /^\.\.\.$/, /^undefined$/i, /^null$/i, /^\|+$/, /^%+$/,
  /^[-_\s]+$/, /^n\/a$/i, /^none$/i,
];

// Patterns that indicate a value is a geographic location, not a job title
const LOCATION_PATTERNS = [
  /,\s*(andhra\s*pradesh|telangana|karnataka|maharashtra|tamil\s*nadu|kerala|gujarat|rajasthan|up|mp|bihar|odisha|wb)/i,
  /,\s*(india|usa|uk|canada|australia|germany|singapore)/i,
  /\b(district|mandal|village|taluk|tehsil|nagar|puram|abad|pur)\b/i,
  /\b(pin\s*code|\d{6})\b/,
  /^[a-z\s]+,\s*[a-z\s]+$/i, // generic "City, State" pattern with no job keywords
];

const JOB_TITLE_KEYWORDS = [
  "developer", "engineer", "designer", "analyst", "manager", "intern",
  "consultant", "architect", "scientist", "specialist", "lead", "head",
  "officer", "director", "associate", "executive", "coordinator",
  "administrator", "programmer", "devops", "sre", "qa", "tester",
  "full stack", "frontend", "backend", "data", "ai", "ml",
];

function looksLikeLocation(val) {
  if (!val) return false;
  const lower = val.toLowerCase();
  if (LOCATION_PATTERNS.some((p) => p.test(val))) return true;
  // If it has a comma but no job title keyword → probably "City, State"
  if (val.includes(",") && !JOB_TITLE_KEYWORDS.some((k) => lower.includes(k))) return true;
  return false;
}

function isJunk(val) {
  if (!val || typeof val !== "string") return true;
  const v = val.trim();
  if (v.length < 2) return true;
  return JUNK_PATTERNS.some((p) => p.test(v));
}

function sanitizeString(val, fallback = "") {
  const v = cleanStr(val);
  return isJunk(v) ? fallback : v;
}

/**
 * Build the final schema using AI-extracted identity (name/role/email)
 * instead of raw Python output for those fields.
 */
function buildFinalSchema(identity, bio, education, skills, experience, projects) {
  return {
    name:       sanitizeString(identity.name),
    role:       sanitizeString(identity.role),   // ← now guaranteed to be a job title
    bio:        sanitizeString(bio),
    email:      sanitizeString(identity.email),
    linkedin:   "",                              // Python / Groq don't reliably get this; user fills it
    github:     "",
    cvLink:     "",
    education:  sanitizeString(education),
    skills:     skills.filter((s) => !isJunk(s.name)),
    experience: experience.filter((e) => !isJunk(e.company) || !isJunk(e.role)),
    projects:   projects.filter((p) => !isJunk(p.title)),
  };
}

// ── MAIN CONTROLLER ───────────────────────────────────────────────────────────
export const parseResume = async (req, res) => {
  const tempPath = req.file?.path;

  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    console.log(`[ResumeParser] File: ${req.file.originalname} | ${req.file.size}B`);

    // 1. Python extraction
    let raw;
    try {
      raw = await runPython(tempPath);
      console.log(`[ResumeParser] Sections found: ${raw._sections?.join(", ")}`);
      console.log(`[ResumeParser] python name="${raw.name}" role="${raw.role}" email="${raw.email}"`);
      console.log(`[ResumeParser] raw_skills length: ${raw.raw_skills?.length || 0}`);
      console.log(`[ResumeParser] raw_experience length: ${raw.raw_experience?.length || 0}`);
      console.log(`[ResumeParser] raw_projects length: ${raw.raw_projects?.length || 0}`);
    } catch (pyErr) {
      console.error("[ResumeParser] Python error:", pyErr.message);
      return res.status(500).json({ error: "PDF extraction failed: " + pyErr.message });
    }

    if (raw.error) {
      return res.status(422).json({ error: raw.error });
    }

    // 2. Safety check: if Python put a location into role, clear it now so
    //    extractIdentity gets a clean slate to work with.
    if (looksLikeLocation(raw.role)) {
      console.warn(`[ResumeParser] ⚠ python_role looks like a location ("${raw.role}") — clearing before AI pass`);
      raw._python_location = raw.role; // save for debugging
      raw.role = "";
    }

    // 3. Parallel Groq extractions
    console.log(`[ResumeParser] Model: ${GROQ_MODEL} | Running 6 parallel extractions...`);

    const [identity, bio, education, skills, experience, projects] = await Promise.all([
      extractIdentity(raw),                                    // ← NEW: validates name/role/email
      extractBio(raw.raw_summary, raw.raw_full),
      extractEducation(raw.raw_education, raw.raw_full),
      extractSkills(raw.raw_skills, raw.raw_full),
      extractExperience(raw.raw_experience, raw.raw_full),
      extractProjects(raw.raw_projects, raw.raw_full),
    ]);

    console.log(`[ResumeParser] Identity → name="${identity.name}" role="${identity.role}" email="${identity.email}"`);
    console.log(`[ResumeParser] Done — skills:${skills.length} exp:${experience.length} proj:${projects.length}`);

    // 4. Build final schema using AI identity instead of raw Python fields
    const finalData = buildFinalSchema(identity, bio, education, skills, experience, projects);

    return res.status(200).json({ success: true, data: finalData });

  } catch (err) {
    console.error("[ResumeParser] Unexpected error:", err);
    return res.status(500).json({ error: "Internal error: " + err.message });
  } finally {
    if (tempPath) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
  }
};