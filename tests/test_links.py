from docforge.links import rewrite_internal_links


def test_simple_relative_link_rewritten():
    md = "[Other](other.html)"
    assert rewrite_internal_links(md) == "[Other](other.md)"


def test_relative_link_with_anchor_preserved():
    md = "[Section](page.html#intro)"
    assert rewrite_internal_links(md) == "[Section](page.md#intro)"


def test_relative_subdir_link_rewritten():
    md = "[Sub](dir/sub/page.html)"
    assert rewrite_internal_links(md) == "[Sub](dir/sub/page.md)"


def test_https_link_untouched():
    md = "[Ext](https://example.com/page.html)"
    assert rewrite_internal_links(md) == "[Ext](https://example.com/page.html)"


def test_http_link_untouched():
    md = "[Ext](http://example.com/page.html)"
    assert rewrite_internal_links(md) == "[Ext](http://example.com/page.html)"


def test_mailto_link_untouched():
    md = "[Email](mailto:foo@bar.html)"
    assert rewrite_internal_links(md) == "[Email](mailto:foo@bar.html)"


def test_anchor_only_link_untouched():
    md = "[Anchor](#intro)"
    assert rewrite_internal_links(md) == "[Anchor](#intro)"


def test_non_html_extension_untouched():
    md = "[Pic](image.png)"
    assert rewrite_internal_links(md) == "[Pic](image.png)"


def test_multiple_links_in_one_string():
    md = "See [A](a.html) and [B](b.html#x) and [C](https://c.com/c.html)."
    expected = "See [A](a.md) and [B](b.md#x) and [C](https://c.com/c.html)."
    assert rewrite_internal_links(md) == expected


def test_empty_string_returns_empty():
    assert rewrite_internal_links("") == ""


# Autolink form coverage (spec §5 risk: Kreuzberg may emit `<href>` for `<a href="X">X</a>`).
def test_autolink_relative_html_rewritten():
    md = "See <other.html> for details."
    assert rewrite_internal_links(md) == "See <other.md> for details."


def test_autolink_relative_html_with_anchor_rewritten():
    md = "See <page.html#intro> for details."
    assert rewrite_internal_links(md) == "See <page.md#intro> for details."


def test_autolink_external_https_untouched():
    md = "See <https://example.com/page.html>."
    assert rewrite_internal_links(md) == "See <https://example.com/page.html>."


def test_autolink_external_http_untouched():
    md = "See <http://example.com/page.html>."
    assert rewrite_internal_links(md) == "See <http://example.com/page.html>."


def test_autolink_subdir_rewritten():
    md = "<dir/sub/page.html>"
    assert rewrite_internal_links(md) == "<dir/sub/page.md>"


def test_protocol_relative_md_link_untouched():
    md = "[CDN](//cdn.example.com/page.html)"
    assert rewrite_internal_links(md) == "[CDN](//cdn.example.com/page.html)"


def test_protocol_relative_autolink_untouched():
    md = "<//cdn.example.com/page.html>"
    assert rewrite_internal_links(md) == "<//cdn.example.com/page.html>"
