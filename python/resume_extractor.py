#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
server/python/resume_extractor.py

Strict section-aware PDF extractor.
Uses pdfplumber (primary) + pymupdf (fallback).
Each section is ISOLATED — no leakage between sections.
Outputs clean UTF-8 JSON.

Install: pip install pdfplumber pymupdf pillow
"""

import sys, json, re, os, unicodedata

# ── Imports ───────────────────────────────────────────────────────────────────
try:
    import pdfplumber
except ImportError:
    sys.stdout.buffer.write(json.dumps({"error": "Run: pip install pdfplumber pymupdf pillow"}).encode())
    sys.exit(1)

try:
    import fitz
    HAS_FITZ = True
except ImportError:
    HAS_FITZ = False

# ── Unicode / garbage cleaner ─────────────────────────────────────────────────
CHAR_MAP = {
    "\u2013": "-", "\u2014": "-", "\u2018": "'", "\u2019": "'",
    "\u201C": '"', "\u201D": '"', "\u00A0": " ", "\u2022": "",
    "\u25CF": "", "\u25A0": "", "\u2192": "->", "\uFFFD": "",
    "\u200B": "", "\u200C": "", "\u200D": "", "\uFEFF": "",
    "\u2026": "...", "\u00B7": "", "\u2023": "", "\u25E6": "",
}

def clean(s):
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFC", s)
    for c, r in CHAR_MAP.items():
        s = s.replace(c, r)
    # Remove non-printable except tab/newline/space
    s = re.sub(r"[^\x09\x0A\x0D\x20-\x7E\u00C0-\u024F]", "", s)
    s = re.sub(r"[ \t]{2,}", " ", s)
    return s.strip()

# ── Section keyword map ───────────────────────────────────────────────────────
# ORDER MATTERS — more specific first
SECTIONS = [
    ("summary",     ["summary", "about me", "about", "profile", "objective",
                     "professional summary", "career objective", "overview", "introduction"]),
    ("experience",  ["work experience", "professional experience", "employment history",
                     "work history", "career history", "experience", "internship",
                     "internships", "employment", "positions held"]),
    ("education",   ["education", "educational background", "academic background",
                     "qualifications", "academic qualifications", "schooling", "degrees",
                     "academics"]),
    ("skills",      ["technical skills", "core competencies", "key skills", "tech stack",
                     "skills", "technologies", "tools", "expertise", "proficiencies",
                     "areas of expertise", "competencies"]),
    ("projects",    ["projects", "personal projects", "key projects", "academic projects",
                     "portfolio", "side projects", "notable projects", "selected projects",
                     "works"]),
    ("certifications", ["certifications", "certificates", "achievements", "awards",
                        "honors", "licenses", "accomplishments"]),
    ("contact",     ["contact", "contact information", "personal details", "links",
                     "social links", "personal information"]),
    ("languages",   ["languages", "spoken languages", "language skills"]),
]

def match_section(line: str):
    """Return section key if this line IS a section heading. Strict match only."""
    s = line.strip().lower()
    # Remove trailing punctuation
    s = re.sub(r"[:\.\-_\|]+$", "", s).strip()
    
    for key, keywords in SECTIONS:
        if s in keywords:
            return key
        # Only match if the ENTIRE line is basically the keyword
        for kw in keywords:
            if s == kw or s == kw + "s":
                return key
    return None

def is_section_heading(line: str) -> bool:
    """Heuristic: short ALL-CAPS or Title Case line with no sentence structure."""
    s = line.strip()
    if not s or len(s) > 60:
        return False
    # Pure ALL CAPS heading like "WORK EXPERIENCE"
    if s.isupper() and 2 < len(s.replace(" ", "")) <= 50:
        return True
    # Title Case heading with ≤5 words, no lowercase filler words mid-sentence
    words = s.split()
    if 1 <= len(words) <= 5:
        alpha_words = [w for w in words if w.isalpha()]
        if alpha_words and all(w[0].isupper() for w in alpha_words):
            # Make sure it's not a person's name (has no common title pattern)
            if not re.search(r"\b(and|the|of|in|at|for|with|to)\b", s, re.I):
                return True
    return False

# ── PDF extraction ────────────────────────────────────────────────────────────
def extract_pdfplumber(path: str) -> str:
    pages = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text(layout=True, x_tolerance=3, y_tolerance=3)
            if text:
                pages.append(clean(text))
            # Extract tables too (for skill tables)
            for table in page.extract_tables():
                for row in table:
                    row_str = " | ".join(clean(c) for c in row if c and c.strip())
                    if row_str.strip():
                        pages.append(row_str)
    return "\n".join(pages)

def extract_pymupdf(path: str) -> str:
    if not HAS_FITZ:
        return ""
    doc = fitz.open(path)
    out = [clean(page.get_text("text")) for page in doc]
    doc.close()
    return "\n".join(out)

# ── Strict section splitter ───────────────────────────────────────────────────
def split_sections(raw: str) -> dict:
    """
    Walk line-by-line.
    A line becomes a section boundary ONLY if it exactly matches a keyword
    OR is a short heading-style line that contains a keyword.
    Content is accumulated STRICTLY under its section — no leakage.
    """
    lines = raw.splitlines()
    buckets = {"header": []}
    current = "header"
    section_line_indices = set()

    # First pass: mark which lines are section headings
    heading_map = {}  # line_index -> section_key
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        sec = match_section(stripped)
        if sec is None and is_section_heading(stripped):
            # Try keyword partial match
            low = stripped.lower()
            for key, kws in SECTIONS:
                if any(kw in low for kw in kws):
                    sec = key
                    break
        if sec:
            heading_map[i] = sec

    # Second pass: accumulate content
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        if i in heading_map:
            current = heading_map[i]
            if current not in buckets:
                buckets[current] = []
        else:
            if current not in buckets:
                buckets[current] = []
            buckets[current].append(clean(line))

    return {k: "\n".join(v).strip() for k, v in buckets.items()}

# ── Contact extractor ─────────────────────────────────────────────────────────
def extract_contact(full_text: str) -> dict:
    email    = re.search(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", full_text)
    phone    = re.search(r"(?<!\d)[\+]?[0-9]{1,3}[\s\-\.]?[0-9]{10}(?!\d)", full_text)
    linkedin = re.search(r"linkedin\.com/in/([a-zA-Z0-9_\-]+)", full_text, re.I)
    github   = re.search(r"github\.com/([a-zA-Z0-9_\-]+)(?!/[a-zA-Z0-9_\-]+/[a-zA-Z0-9_\-]+)", full_text, re.I)
    
    return {
        "email":    clean(email.group(0)) if email else "",
        "phone":    clean(phone.group(0)) if phone else "",
        "linkedin": f"https://linkedin.com/in/{linkedin.group(1)}" if linkedin else "",
        "github":   f"https://github.com/{github.group(1)}" if github else "",
    }

# ── Name / role extractor ─────────────────────────────────────────────────────
def extract_identity(header: str) -> dict:
    lines = [l.strip() for l in header.splitlines() if l.strip()]
    name = ""
    role = ""
    
    # Skip lines that look like contact info
    def is_contact_line(l):
        return any(x in l for x in ["@", "http", "linkedin", "github", "+91", "+1"]) or \
               re.search(r"\d{7,}", l)
    
    for line in lines[:10]:
        if is_contact_line(line):
            continue
        words = line.split()
        # Name: 2-4 capitalized words, no numbers
        if not name and 1 < len(words) <= 4 and \
           all(w[0].isupper() for w in words if w.isalpha()) and \
           not any(c.isdigit() for c in line):
            name = clean(line)
            continue
        # Role: first non-name, non-contact line after name
        if name and not role and len(line) < 80 and not is_contact_line(line):
            # Should look like a job title, not a sentence
            if len(words) <= 8 and not line.endswith("."):
                role = clean(line)
                break
    
    return {"name": name, "role": role}

# ── Main ──────────────────────────────────────────────────────────────────────
def parse_resume(pdf_path: str) -> dict:
    # Extract text
    raw = extract_pdfplumber(pdf_path)
    char_count = len(raw.strip())
    
    if char_count < 100:
        print(f"pdfplumber: {char_count} chars, trying pymupdf", file=sys.stderr)
        raw = extract_pymupdf(pdf_path)
        char_count = len(raw.strip())
    
    if char_count < 40:
        return {"error": "Cannot extract text. Use a text-based PDF, not a scanned image."}
    
    # Split into sections
    sections = split_sections(raw)
    contact  = extract_contact(raw)
    identity = extract_identity(sections.get("header", ""))
    
    # Return ALL section text cleanly — let Groq AI structure it
    return {
        "name":             identity["name"],
        "role":             identity["role"],
        "email":            contact["email"],
        "phone":            contact["phone"],
        "linkedin":         contact["linkedin"],
        "github":           contact["github"],
        # Raw section text — Groq will structure these
        "raw_summary":      sections.get("summary", ""),
        "raw_education":    sections.get("education", ""),
        "raw_skills":       sections.get("skills", ""),
        "raw_experience":   sections.get("experience", ""),
        "raw_projects":     sections.get("projects", ""),
        "raw_certifications": sections.get("certifications", ""),
        # Debug info
        "_sections":        list(sections.keys()),
        "_charCount":       char_count,
    }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.stdout.buffer.write(json.dumps({"error": "Usage: python resume_extractor.py <file.pdf>"}).encode("utf-8"))
        sys.exit(1)
    
    p = sys.argv[1]
    if not os.path.exists(p):
        sys.stdout.buffer.write(json.dumps({"error": f"File not found: {p}"}).encode("utf-8"))
        sys.exit(1)
    
    result = parse_resume(p)
    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False, indent=2).encode("utf-8"))