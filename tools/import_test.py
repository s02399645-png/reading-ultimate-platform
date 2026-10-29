#!/usr/bin/env python3
"""Turns a 'full test' HTML file (3 passages, 40 questions) into 3 Marginalia passage JSON files,
works out anchor words + evidence sentence for every question, and appends to ANCHORS.md.
Usage: python3 tools/import_test.py <test-number> <path/to/full_test.html>
Needs: pip install beautifulsoup4 lxml   and node (to read the answer key)."""
import sys, re, json, subprocess, html as H, math
from pathlib import Path
from bs4 import BeautifulSoup, NavigableString, Tag

ROOT = Path(__file__).resolve().parent.parent
STOP = set("""a an the and or but if of to in on at by for with from as is are was were be been being it its this that these those he she they them his her their we you i our your not no
do does did has have had will would can could may might must shall should which who whom whose what when where why how than then so such there here also into over under up down out off about after before
between through during each other more most some any all both only very just one two three four five six seven eight nine ten per cent new many much own same other another""".split())
LIMIT = set("only all every none never always some most few not no first last once initially unless although though however but whereas while instead rather mainly mostly any each both either neither nearly almost".split())
ABBR = set("dr mr mrs ms st no vs etc fig inc ltd co e.g i.e u.s".split())

def stem(w):
    w = w.lower().strip("'’-")
    for suf in ("ing", "edly", "ed", "es", "ly", "s"):
        if len(w) > len(suf) + 3 and w.endswith(suf): return w[: -len(suf)]
    return w
def words(t): return re.findall(r"\w[\w'’\-]*", t)
def norm(s): return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s-]", "", str(s).lower())).strip()

def split_sentences(text):
    text = re.sub(r"\s+", " ", text).strip(); out, start = [], 0
    for m in re.finditer(r"[.!?]['’\"”)]?\s+(?=['‘\"“(]?[A-Z0-9])", text):
        chunk = text[start:m.start() + 1]; last = chunk.split(" ")[-1].rstrip(".!?'’\"”)").lower()
        if last in ABBR or re.fullmatch(r"[a-z]", last) : continue
        end = m.end(); out.append(text[start:m.end()].strip()); start = end
    if start < len(text): out.append(text[start:].strip())
    return [s for s in out if s]

def inline(node, markers=True):
    """serialise node to a small safe HTML subset; inputs/selects become {{n}} markers"""
    res = ""
    for c in node.children:
        if isinstance(c, NavigableString): res += H.escape(str(c).replace("\xa0", " "))
        elif isinstance(c, Tag):
            if c.name in ("input", "select") and c.get("id", "").startswith("q"): res += "{{" + c["id"][1:] + "}}"
            elif c.name in ("strong", "b"): res += "<strong>" + inline(c) + "</strong>"
            elif c.name in ("em", "i"): res += "<em>" + inline(c) + "</em>"
            elif c.name == "br": res += "<br>"
            elif c.name in ("ul", "ol"): res += "<ul>" + inline(c) + "</ul>"
            elif c.name == "li": res += "<li>" + re.sub(r"^\s*•\s*", "", inline(c)).strip() + "</li>"
            elif c.name == "p":
                st = (c.get("style") or "") + " ".join(c.get("class", []))
                cls = ' class="ct"' if ("center" in st) else ""
                res += f"<p{cls}>" + inline(c) + "</p>"
            elif c.name in ("div", "span", "label"): res += inline(c)
    return res
def plain(node): return re.sub(r"\s+", " ", node.get_text(" ", strip=True).replace("\xa0", " ")).strip()

def read_answers(path):
    src = Path(path).read_text(encoding="utf8"); m = re.search(r"const correctAnswers = (\{.*?\n\s*\});", src, re.S)
    js = "console.log(JSON.stringify(" + m.group(1) + "))"
    return json.loads(subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout)

def parse_passage(div):
    title = plain(div.find("h4")); sub = ""; paras = []; pending = ""
    for p in div.find_all("p", recursive=False):
        st = p.get("style") or ""
        if "italic" in st and "center" in st: sub = plain(p); continue
        label = ""; s = p.find("strong")
        if s and re.fullmatch(r"[A-H]|\d{1,2}", plain(s)) and p.get_text().lstrip().startswith(plain(s)):
            label = plain(s); s.extract()
        txt = plain(p)
        if not label and re.fullmatch(r"[A-H]|\d{1,2}", txt): pending = txt; continue   # a lone section marker belongs to the next paragraph
        if txt: paras.append((label or pending, txt)); pending = ""
    out = []
    for i, (label, txt) in enumerate(paras, 1):
        out.append({"id": f"p{i}", "label": label, "sentences": [{"id": f"p{i}s{j}", "text": s} for j, s in enumerate(split_sentences(txt), 1)]})
    return title, sub, out

def parse_groups(qset, key):
    groups = []
    for gi, blk in enumerate(qset.select(".question"), 1):
        a, b = int(blk["data-q-start"]), int(blk["data-q-end"])
        pr = blk.select_one(".question-prompt"); intro = ""
        for p in pr.find_all("p", recursive=False):
            if "on your answer sheet" in p.get_text(): continue
            intro += "<p>" + inline(p) + "</p>"
        intro = re.sub(r"<p><strong>Questions[^<]*</strong><br>", "<p>", intro)
        g = {"id": f"g{gi}", "title": f"Questions {a}–{b}" if b > a else f"Question {a}", "intro": intro, "questions": []}
        lst = blk.select_one(".people-section")
        if lst: g["list"] = [{"k": plain(li.find("strong")), "t": plain(li).split(" ", 1)[1] if " " in plain(li) else ""} for li in lst.find_all("li")]
        def ans(n): return key[str(n)]
        if blk.select(".tf-question"):
            for t in blk.select(".tf-question"):
                n = int(t["data-q-start"]); opts = [i["value"] for i in t.select("input")]
                g["type"] = "tfng" if "TRUE" in opts else "ynng"
                g["questions"].append({"id": f"q{n}", "n": n, "prompt": plain(t.select_one(".tf-question-text")), "options": opts, "answer": ans(n)})
        elif blk.select(".mcq-question"):
            g["type"] = "mcq"
            for t in blk.select(".mcq-question"):
                n = int(t["data-q-start"]); pp = t.find("p"); pt = re.sub(r"^\d+\s*", "", plain(pp))
                opts = [f'{plain(l.find("strong"))}. ' + plain(l).split(" ", 1)[1] for l in t.select("label")]
                g["questions"].append({"id": f"q{n}", "n": n, "prompt": pt, "options": opts, "answer": ans(n)})
        elif blk.select(".multi-choice-question"):
            g["type"] = "multi"; t = blk.select_one(".multi-choice-question")
            opts = [f'{plain(l.find("strong"))}. ' + plain(l).split(" ", 1)[1] for l in t.select("label")]
            g["questions"].append({"id": f"q{a}", "n": a, "n2": b, "marks": b - a + 1, "prompt": plain(pr.find_all("p")[-1]), "options": opts, "answer": sorted(ans(a))})
        elif blk.select(".matching-form-row"):
            for r in blk.select(".matching-form-row"):
                sel = r.select_one("select"); n = int(sel["id"][1:]); ov = [o["value"] for o in sel.select("option") if o.get("value")]
                lab = plain(r.select_one("label")); lab = re.sub(r"^\d+\s*", "", lab)
                g["questions"].append({"id": f"q{n}", "n": n, "prompt": lab, "options": ov, "answer": ans(n)})
            g["type"] = "heading" if g.get("list") and re.fullmatch(r"[ivx]+", g["list"][0]["k"]) else "match"
        elif blk.select_one(".summary-text"):
            st = blk.select_one(".summary-text"); g["template"] = inline(st); inputs = st.select("input,select")
            g["type"] = "bank" if inputs[0].name == "select" else "completion"
            for el in inputs:
                n = int(el["id"][1:]); par = el.find_parent(["li", "p"]) or st
                ctx = plain(BeautifulSoup(inline(par).replace("{{" + str(n) + "}}", "_____").replace("{{", "[").replace("}}", "]"), "lxml"))
                ctx = re.sub(r"^\d+\s*", "", ctx)
                if "_____" in ctx and par.name == "p": ctx = next((x for x in split_sentences(ctx) if "_____" in x), ctx)
                q = {"id": f"q{n}", "n": n, "prompt": ctx}
                if g["type"] == "bank": q["options"] = [o["value"] for o in el.select("option") if o.get("value")]
                a_ = ans(n)
                if isinstance(a_, list): q["answer"], q["accept"] = a_[0], a_
                else: q["answer"] = a_
                g["questions"].append(q)
        groups.append(g)
    return groups

def best_sentence(ctx_terms, sents, bonus_text=None, only=None, df=None):
    best, bs, second = None, 0, 0
    for sid, text, ptxt in sents:
        if only and not sid.startswith(only + "s"): continue
        st = {stem(w) for w in words(text)}; low = text.lower(); sc = 0
        for t, wgt in ctx_terms:
            if t in st or (t.isdigit() and t in re.sub(r"[,]", "", low)): sc += wgt
        if bonus_text:
            forms = [norm(f) for f in bonus_text if norm(f)]; nt = norm(text)
            if any(f in nt for f in forms): sc += 6
            parts = [norm(x) for x in re.split(r",|/| and ", bonus_text[0]) if norm(x)]
            if len(parts) > 1: sc += 3 * sum(1 for x in parts if x in nt)
        if sc > bs: second, bs, best = bs, sc, sid
        elif sc > second: second = sc
    return best, bs, second

def anchors_for(q, g, paras, key_text, sents, passage_stems, para_by_label):
    ctx = q["prompt"]
    if g["type"] in ("heading",):
        pl = re.search(r"(?:Paragraph|Section)\s+([A-H]|\d+)|(Z)Z", ctx); lab = pl.group(1) if pl else None
        ctx2 = next((x["t"] for x in g["list"] if x["k"] == q["answer"]), "")
        pid = para_by_label.get(lab); terms = [(stem(w), 1) for w in words(ctx2) if w.lower() not in STOP and len(w) > 3]
        sid, sc, _ = best_sentence(terms, sents, only=pid); anchors = [w for w in words(ctx2) if w.lower() not in STOP and len(w) > 3][:4]
        return anchors, sid, ("high" if sc >= 2 else "med")
    if g["type"] == "match":
        pid = para_by_label.get(q["answer"]) if re.fullmatch(r"[A-H]", q["answer"]) and "paragraph" in key_text.lower() else None
        if not pid and g.get("list"):  # list-matching (dates, endings)
            item = next((x["t"] for x in g["list"] if x["k"] == q["answer"]), "")
            ctx = ctx + " " + item
    if g["type"] == "bank":
        q_answer_text = [next((x["t"] for x in g["list"] if x["k"] == q["answer"]), "")]
    elif g["type"] == "multi":
        q_answer_text = None; ctx = ctx + " " + " ".join(o[3:] for o in q["options"] if o[0] in q["answer"])
    elif g["type"] == "mcq":
        q_answer_text = None; ctx = ctx + " " + next((o[3:] for o in q["options"] if o[0] == q["answer"]), "")
    else: q_answer_text = ([q["answer"]] + [x for x in q.get("accept", []) if x != q["answer"]]) if g["type"] == "completion" else None
    toks = words(ctx); names, nums, lim, keys = [], [], [], []
    for i, w in enumerate(toks):
        if re.fullmatch(r"\d[\d,.]*", w): nums.append(w)
        elif w[0].isupper() and i > 0 and w.lower() not in STOP and w not in ("TRUE","FALSE","NOT","GIVEN","YES","NO"): names.append(w)
        elif w.lower() in LIMIT: lim.append(w)
        elif w.lower() not in STOP and len(w) >= 4 and w != "_____": keys.append(w)
    nm = []; 
    for w in names:
        if nm and ctx.find(nm[-1] + " " + w) >= 0: nm[-1] += " " + w
        else: nm.append(w)
    keys = sorted(set(keys), key=lambda w: (stem(w) not in passage_stems, passage_stems.get(stem(w), 99), -len(w)))[:4]
    anchors = []; [anchors.append(x) for x in nm + nums + lim + keys if x not in anchors]; anchors = anchors[:6]
    terms = [(stem(w), 2.0) for x in nm for w in words(x)] + [(n.replace(",", ""), 2.5) for n in nums] + [(stem(w), 1.0) for w in keys] + [(stem(w), 0.5) for w in toks if w.lower() not in STOP and w.lower() not in LIMIT and len(w) > 4 and stem(w) in passage_stems]
    only = para_by_label.get(q["answer"]) if g["type"] == "match" and re.fullmatch(r"[A-H]", q["answer"]) and not g.get("list") else None
    sid, sc, second = best_sentence(terms, sents, q_answer_text, only, passage_stems)
    conf = "high" if (g["type"] in ("completion", "bank") and sid and q_answer_text and any(norm(f) in norm(next(t for i, t, _ in sents if i == sid)) for f in q_answer_text)) or (sc >= 4 and sc > second * 1.25) else ("med" if sc >= 2 else "low")
    if q.get("answer") == "NOT GIVEN" and g["type"] in ("tfng", "ynng"): conf = "low"
    return anchors, sid, conf

def main(num, path):
    soup = BeautifulSoup(Path(path).read_text(encoding="utf8"), "lxml"); key = read_answers(path); md = [f"\n## Test {num}\n"]
    outdir = ROOT / "worker" / "passages"; webdata = ROOT / "web" / "data"; webdata.mkdir(exist_ok=True)
    for part in (1, 2, 3):
        title, sub, paras = parse_passage(soup.select_one(f"#passage-text-{part}")); groups = parse_groups(soup.select_one(f"#questions-{part}"), key)
        sents = [(s["id"], s["text"], pa["id"]) for pa in paras for s in pa["sentences"]]
        stems = {}
        for _, t, _ in sents:
            for w in set(stem(x) for x in words(t)): stems[w] = stems.get(w, 0) + 1
        by_label = {pa["label"]: pa["id"] for pa in paras if pa["label"]}
        md.append(f"\n### Passage {part}: {title}\n\n| Q | Type | Anchor words (in the question) | Where to look | Confidence |\n|---|---|---|---|---|")
        for g in groups:
            kt = g["intro"]
            for q in g["questions"]:
                a, sid, conf = anchors_for(q, g, paras, kt, sents, stems, by_label)
                q["anchors"] = a; q["evidence"] = sid; q["conf"] = conf
                if sid:
                    pa = next(p for p in paras if sid.startswith(p["id"] + "s")); q["where"] = (f"paragraph {pa['label']}" if pa["label"] else f"paragraph {pa['id'][1:]}") + f", sentence {sid.split('s')[1]}"
                    st = next(t for i, t, _ in sents if i == sid); wset = {stem(x) for x in a for x in words(x)}
                    q["matches"] = [w for w in words(st) if stem(w) in wset or w.replace(",", "") in {x.replace(",", "") for x in a}][:6]
                md.append(f"| {q['n']}{'–' + str(q['n2']) if q.get('n2') else ''} | {g['type']} | {', '.join(a) or '—'} | {q.get('where','—')} | {conf} |")
        pid = f"test-{num}-p{part}"
        data = {"id": pid, "format": "test", "test": int(num), "part": part, "title": title, "subtitle": sub, "level": "Academic Reading", "minutes": 20, "paragraphs": paras, "groups": groups}
        for d in (outdir, webdata): (d / f"{pid}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf8")
        print(pid, title, sum(q.get("marks", 1) for g in groups for q in g["questions"]), "marks")
    with open(ROOT / "ANCHORS.md", "a", encoding="utf8") as f: f.write("\n".join(md) + "\n")

if __name__ == "__main__": main(sys.argv[1], sys.argv[2])
