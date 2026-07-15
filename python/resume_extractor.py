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
                     "professional summary", "career objective", "career summary",
                     "executive summary", "professional profile", "personal statement",
                     "overview", "introduction"]),
    ("experience",  ["work experience", "professional experience", "employment history",
                     "work history", "career history", "experience", "internship",
                     "internships", "employment", "positions held", "relevant experience",
                     "professional background", "industry experience", "work background",
                     "internship experience", "professional history", "job history",
                     "volunteer experience"]),
    ("education",   ["education", "educational background", "academic background",
                     "qualifications", "academic qualifications", "schooling", "degrees",
                     "academics", "academic history", "education and training",
                     "academic details", "educational qualifications", "education details"]),
    ("skills",      ["technical skills", "core competencies", "key skills", "tech stack",
                     "skills", "technologies", "tools", "expertise", "proficiencies",
                     "areas of expertise", "competencies", "skill set", "skills summary",
                     "technical expertise", "technical proficiencies", "hard skills",
                     "programming skills", "computer skills", "it skills",
                     "skills and tools", "skills & tools", "skills and abilities",
                     "technologies and tools", "tools and technologies",
                     "programming languages", "software skills"]),
    ("projects",    ["projects", "personal projects", "key projects", "academic projects",
                     "portfolio", "side projects", "notable projects", "selected projects",
                     "works", "project experience", "major projects", "mini projects",
                     "technical projects", "featured projects", "project work",
                     "capstone projects", "relevant projects"]),
    ("certifications", ["certifications", "certificates", "achievements", "awards",
                        "honors", "honours", "licenses", "accomplishments",
                        "certifications and achievements", "achievements and awards",
                        "awards and honors", "awards and recognition",
                        "courses and certifications", "training and certifications",
                        "licenses and certifications"]),
    ("contact",     ["contact", "contact information", "personal details", "links",
                     "social links", "personal information", "contact details",
                     "contact me", "get in touch"]),
    ("languages",   ["languages", "spoken languages", "language skills",
                     "languages known"]),
    ("other",       ["hobbies", "interests", "hobbies and interests", "extracurricular",
                     "extracurricular activities", "activities", "references",
                     "declaration", "strengths", "publications"]),
]

def normalize_heading(line: str) -> str:
    """Lowercase, strip decorations/punctuation so 'TECHNICAL SKILLS :' == 'technical skills'."""
    s = line.strip().lower()
    # Strip leading decorations/bullets/numbering like "3. ", "# ", "> ", "-- "
    s = re.sub(r"^[\s>\#\*\-_=\|:\.\d\)\(]+", "", s)
    # Strip trailing punctuation / decoration
    s = re.sub(r"[\s:\.\-_\|=\*>]+$", "", s)
    # Collapse '&' to 'and' so 'Skills & Tools' matches 'skills and tools'
    s = s.replace("&", " and ")
    s = re.sub(r"\s{2,}", " ", s)
    return s.strip()

def match_section(line: str):
    """Return section key if this line IS a section heading. Strict match only."""
    s = normalize_heading(line)
    if not s:
        return None
    for key, keywords in SECTIONS:
        if s in keywords:
            return key
        # Only match if the ENTIRE line is basically the keyword
        for kw in keywords:
            if s == kw or s == kw + "s":
                return key
    return None

# "SKILLS: Python, SQL" — heading and content on the same line
INLINE_HEADING_RE = re.compile(r"^\s*([A-Za-z][A-Za-z &/]{2,40})\s*[:\-]\s+(\S.*)$")

def match_inline_section(line: str):
    """Detect 'Heading: content' lines. Returns (section_key, content) or None."""
    m = INLINE_HEADING_RE.match(line.strip())
    if not m:
        return None
    sec = match_section(m.group(1))
    if sec:
        return (sec, m.group(2).strip())
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
def detect_column_split(page):
    """
    Detect a two-column layout: look for a vertical gutter (a band of x-space
    that body words don't cross) covering most of the page's text height.
    Full-width lines at the top (name / contact header) are tolerated — they
    become a separate header band.
    Returns (split_x, header_bottom_y) or None for single-column pages.
    """
    try:
        words = page.extract_words()
    except Exception:
        return None
    if len(words) < 30:
        return None

    x0 = min(w["x0"] for w in words)
    x1 = max(w["x1"] for w in words)
    width = x1 - x0
    top = min(w["top"] for w in words)
    bottom = max(w["bottom"] for w in words)
    height = bottom - top
    if width <= 0 or height <= 0:
        return None

    # Scan candidate gutters in the middle 20-80% of the text width.
    best = None
    steps = 60
    for i in range(int(steps * 0.2), int(steps * 0.8)):
        gx = x0 + width * i / steps
        crossing = [w for w in words if w["x0"] < gx < w["x1"]]
        # Tolerate a few crossers ONLY if they all sit in the top 30% of the
        # text (the full-width name/contact header of most resumes).
        if crossing:
            if len(crossing) > max(3, len(words) * 0.12):
                continue
            if any(w["bottom"] > top + height * 0.30 for w in crossing):
                continue
            header_bottom = max(w["bottom"] for w in crossing)
        else:
            header_bottom = 0
        body = [w for w in words if w["top"] >= header_bottom]
        left  = [w for w in body if w["x1"] <= gx]
        right = [w for w in body if w["x0"] >= gx]
        # Both sides need a meaningful share of the body content.
        if len(left) < len(body) * 0.18 or len(right) < len(body) * 0.18:
            continue
        # Require a real gap band (not just a point between two words).
        left_edge  = max(w["x1"] for w in left)
        right_edge = min(w["x0"] for w in right)
        gap = right_edge - left_edge
        if gap < 18:  # ~0.25in gutter minimum
            continue
        if best is None or gap > best[2]:
            best = ((left_edge + right_edge) / 2, header_bottom, gap)
    return (best[0], best[1]) if best else None

def extract_page_text(page) -> str:
    """Extract one page; if a two-column layout is detected, read the header
    band full-width, then each column separately (left first, then right) so
    sections don't interleave."""
    split = detect_column_split(page)
    if split:
        split_x, header_bottom = split
        boxes = []
        if header_bottom > 0:
            boxes.append((0, 0, page.width, min(header_bottom + 2, page.height)))
        body_top = min(header_bottom, page.height)
        boxes.append((0, body_top, split_x, page.height))
        boxes.append((split_x, body_top, page.width, page.height))
        parts = []
        for box in boxes:
            try:
                col = page.crop(box)
                t = col.extract_text(layout=True, x_tolerance=3, y_tolerance=3)
                if t:
                    parts.append(clean(t))
            except Exception:
                pass
        if parts:
            return "\n".join(parts)
    text = page.extract_text(layout=True, x_tolerance=3, y_tolerance=3)
    return clean(text) if text else ""

def extract_pdfplumber(path: str) -> str:
    pages = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = extract_page_text(page)
            if text:
                pages.append(text)
            # Extract tables too (for skill tables)
            try:
                tables = page.extract_tables()
            except Exception:
                tables = []
            for table in tables:
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
    inline_map  = {}  # line_index -> (section_key, remainder_content)
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        sec = match_section(stripped)
        if sec is None and is_section_heading(stripped):
            # Try keyword partial match on heading-shaped lines
            low = normalize_heading(stripped)
            for key, kws in SECTIONS:
                if any(kw == low or (kw in low and len(low) <= len(kw) + 15) for kw in kws):
                    sec = key
                    break
        if sec is None:
            inline = match_inline_section(stripped)
            if inline:
                inline_map[i] = inline
                continue
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
        elif i in inline_map:
            current, content = inline_map[i]
            if current not in buckets:
                buckets[current] = []
            if content:
                buckets[current].append(clean(content))
        else:
            if current not in buckets:
                buckets[current] = []
            buckets[current].append(clean(line))

    return {k: "\n".join(v).strip() for k, v in buckets.items()}

# ── Contact extractor ─────────────────────────────────────────────────────────
def extract_contact(full_text: str) -> dict:
    email    = re.search(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", full_text)
    phone    = re.search(r"(?<!\d)[\+]?[0-9]{1,3}[\s\-\.]?[0-9]{10}(?!\d)", full_text)
    # Tolerate www., http(s)://, trailing slash, and dots/percent-encoding in slugs.
    linkedin = re.search(r"(?:https?://)?(?:www\.)?linkedin\.com/(?:in|pub)/([a-zA-Z0-9_.\-%]+)/?", full_text, re.I)
    github   = re.search(r"(?:https?://)?(?:www\.)?github\.com/([a-zA-Z0-9][a-zA-Z0-9\-]{0,38})/?", full_text, re.I)

    return {
        "email":    clean(email.group(0)) if email else "",
        "phone":    clean(phone.group(0)) if phone else "",
        "linkedin": f"https://linkedin.com/in/{linkedin.group(1).rstrip('.')}" if linkedin else "",
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
    # Extract text — a corrupt/non-PDF upload must yield a JSON error,
    # not a traceback (the Node controller relays "error" to the user).
    try:
        raw = extract_pdfplumber(pdf_path)
    except Exception as e:
        print(f"pdfplumber failed: {e}", file=sys.stderr)
        raw = ""
    char_count = len(raw.strip())

    if char_count < 100:
        print(f"pdfplumber: {char_count} chars, trying pymupdf", file=sys.stderr)
        try:
            raw = extract_pymupdf(pdf_path)
        except Exception as e:
            print(f"pymupdf failed: {e}", file=sys.stderr)
            raw = ""
        char_count = len(raw.strip())

    if char_count < 40:
        return {"error": "Could not read that file. Please upload a text-based PDF resume (not a scanned image or corrupted file)."}
    
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
        # ALWAYS ship the full text too — the Node controller uses it as the
        # fallback input whenever a section is missing or thin (capped to keep
        # the JSON payload bounded; the controller condenses further anyway).
        "raw_full":         raw[:20000],
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
    
    try:
        result = parse_resume(p)
    except Exception as e:
        result = {"error": f"Resume extraction failed: {e.__class__.__name__}"}
    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False, indent=2).encode("utf-8"))