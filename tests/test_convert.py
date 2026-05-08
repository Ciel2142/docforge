from docforge.convert import ConvertResult, ConvertStatus, _select_body, _strip_sphinx_noise, _flatten_pygments, _h1_text, _soup_title_text, convert_html
from bs4 import BeautifulSoup


def test_status_enum_has_three_values():
    assert {s.name for s in ConvertStatus} == {"OK", "EMPTY", "FAILED"}


def test_default_result_fields_are_none():
    r = ConvertResult(status=ConvertStatus.EMPTY)
    assert r.body_md is None
    assert r.h1_text is None
    assert r.soup_title_text is None
    assert r.error is None


def _soup(html: str):
    return BeautifulSoup(html, "lxml")


def test_select_body_finds_articleBody_directly():
    s = _soup('<html><body><div itemprop="articleBody"><h1>X</h1></div></body></html>')
    body = _select_body(s)
    assert body is not None
    assert body.find("h1").get_text() == "X"


def test_select_body_finds_articleBody_inside_main():
    html = (
        '<html><body><div role="main">'
        '<div itemprop="articleBody"><h1>Y</h1></div>'
        "</div></body></html>"
    )
    body = _select_body(_soup(html))
    assert body is not None
    assert body.find("h1").get_text() == "Y"


def test_select_body_returns_main_when_no_articleBody():
    html = '<html><body><div role="main"><h1>Z</h1></div></body></html>'
    body = _select_body(_soup(html))
    assert body is not None
    assert body.find("h1").get_text() == "Z"


def test_select_body_returns_none_when_neither_present():
    html = "<html><body><main><h1>Q</h1></main></body></html>"
    assert _select_body(_soup(html)) is None


def test_strip_removes_headerlink_anchors():
    s = _soup(
        '<div><h1>Title<a class="headerlink" href="#title">¶</a></h1></div>'
    )
    body = s.find("div")
    _strip_sphinx_noise(body)
    assert body.find("a", class_="headerlink") is None
    assert body.find("h1").get_text() == "Title"


def test_strip_removes_viewcode_link_anchors():
    s = _soup(
        '<div><h1>X</h1><a class="viewcode-link">[source]</a></div>'
    )
    body = s.find("div")
    _strip_sphinx_noise(body)
    assert body.find("a", class_="viewcode-link") is None


def test_strip_leaves_normal_anchors_alone():
    s = _soup('<div><a href="other.html">Other</a></div>')
    body = s.find("div")
    _strip_sphinx_noise(body)
    assert body.find("a") is not None
    assert body.find("a").get_text() == "Other"


def test_flatten_pygments_with_language():
    html = (
        '<div class="highlight-python"><div class="highlight"><pre>'
        '<span class="kn">def</span> <span class="nf">foo</span>():\n'
        "    pass\n"
        "</pre></div></div>"
    )
    s = _soup(f"<div>{html}</div>")
    body = s.find("div")
    _flatten_pygments(s, body)
    pre = body.find("pre")
    code = pre.find("code")
    assert code is not None
    assert code.get("class") == ["language-python"]
    assert "def foo()" in code.get_text()


def test_flatten_pygments_with_highlight_default_emits_no_language():
    html = (
        '<div class="highlight-default"><div class="highlight"><pre>'
        "<span>plain text</span>\n</pre></div></div>"
    )
    s = _soup(f"<div>{html}</div>")
    body = s.find("div")
    _flatten_pygments(s, body)
    pre = body.find("pre")
    code = pre.find("code")
    assert code is not None
    assert code.get("class") is None or code.get("class") == []
    assert "plain text" in code.get_text()


def test_flatten_pygments_handles_nested_highlight_div_alone():
    html = (
        '<div class="highlight"><pre>'
        "<span>x = 1</span>\n</pre></div>"
    )
    s = _soup(f"<div>{html}</div>")
    body = s.find("div")
    _flatten_pygments(s, body)
    pre = body.find("pre")
    code = pre.find("code")
    assert code is not None
    assert "x = 1" in code.get_text()


def test_h1_text_strips_pilcrow():
    s = _soup('<div><h1>Heading¶</h1></div>')
    body = s.find("div")
    assert _h1_text(body) == "Heading"


def test_h1_text_returns_none_when_missing():
    s = _soup('<div><p>no h1</p></div>')
    body = s.find("div")
    assert _h1_text(body) is None


def test_soup_title_text_returns_inner_text():
    s = _soup("<html><head><title>Page Title</title></head></html>")
    assert _soup_title_text(s) == "Page Title"


def test_soup_title_text_returns_none_when_missing():
    s = _soup("<html><head></head></html>")
    assert _soup_title_text(s) is None


def test_soup_title_text_returns_none_when_blank():
    s = _soup("<html><head><title>   </title></head></html>")
    assert _soup_title_text(s) is None


def test_convert_html_returns_ok_for_articleBody():
    html = (
        "<html><head><title>Doc</title></head>"
        '<body><div itemprop="articleBody">'
        "<h1>Heading</h1><p>Hello world.</p>"
        "</div></body></html>"
    )
    r = convert_html(html)
    assert r.status == ConvertStatus.OK
    assert r.body_md is not None
    assert "Hello world." in r.body_md
    assert r.h1_text == "Heading"
    assert r.soup_title_text == "Doc"


def test_convert_html_returns_empty_when_no_body():
    html = "<html><body><main><h1>X</h1></main></body></html>"
    r = convert_html(html)
    assert r.status == ConvertStatus.EMPTY
    assert r.body_md is None


def test_convert_html_returns_failed_on_exception(monkeypatch):
    import docforge.convert as mod

    def boom(*a, **kw):
        raise RuntimeError("kreuzberg blew up")

    monkeypatch.setattr(mod.html_to_markdown, "convert", boom)
    html = (
        '<html><body><div itemprop="articleBody"><h1>X</h1></div></body></html>'
    )
    r = convert_html(html)
    assert r.status == ConvertStatus.FAILED
    assert r.error is not None
    assert "kreuzberg" in r.error


def test_convert_html_emits_atx_headings_and_fenced_code():
    html = (
        '<html><body><div itemprop="articleBody">'
        '<h1>T</h1>'
        '<div class="highlight-python"><div class="highlight"><pre>'
        '<span>x = 1</span>'
        '</pre></div></div>'
        '</div></body></html>'
    )
    r = convert_html(html)
    assert r.status == ConvertStatus.OK
    assert r.body_md.startswith("# T") or "\n# T" in r.body_md
    assert "```python" in r.body_md
    assert "x = 1" in r.body_md
