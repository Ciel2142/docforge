from docforge.openapi.iter import iter_endpoints
from docforge.openapi.render import jsonpointer_encode, render_endpoint


def test_jsonpointer_encode() -> None:
    assert jsonpointer_encode("/pets") == "~1pets"
    assert jsonpointer_encode("/pets/{id}") == "~1pets~1{id}"
    assert jsonpointer_encode("a~b/c") == "a~0b~1c"


def test_render_endpoint_header(petstore_spec: dict) -> None:
    eps = {(e.method, e.path): e for e in iter_endpoints(petstore_spec)}
    md = render_endpoint(eps[("post", "/pets")], spec_filename="petstore-mini.json")
    lines = md.splitlines()
    assert lines[0] == "# POST /pets"
    assert lines[2] == "Source: petstore-mini.json#/paths/~1pets/post"


def test_render_endpoint_tags_and_description(petstore_spec: dict) -> None:
    eps = {(e.method, e.path): e for e in iter_endpoints(petstore_spec)}
    md = render_endpoint(eps[("post", "/pets")], spec_filename="petstore-mini.json")
    assert "**Tags:** pets" in md
    assert "Adds a new pet." in md


def test_render_endpoint_parameters_table(petstore_spec: dict) -> None:
    eps = {(e.method, e.path): e for e in iter_endpoints(petstore_spec)}
    md = render_endpoint(eps[("get", "/pets")], spec_filename="petstore-mini.json")
    assert "## Parameters" in md
    assert "| limit | query | integer (int32) | no | Maximum items to return |" in md


def test_render_endpoint_path_parameter_required(petstore_spec: dict) -> None:
    eps = {(e.method, e.path): e for e in iter_endpoints(petstore_spec)}
    md = render_endpoint(eps[("get", "/pets/{id}")], spec_filename="petstore-mini.json")
    assert "| id | path | string | yes |" in md


def test_render_endpoint_request_body_with_ref(petstore_spec: dict) -> None:
    eps = {(e.method, e.path): e for e in iter_endpoints(petstore_spec)}
    md = render_endpoint(eps[("post", "/pets")], spec_filename="petstore-mini.json")
    assert "## Request Body" in md
    assert "`application/json`: [NewPet](../schemas/NewPet.md) (required)" in md


def test_render_endpoint_responses_with_refs(petstore_spec: dict) -> None:
    eps = {(e.method, e.path): e for e in iter_endpoints(petstore_spec)}
    md = render_endpoint(eps[("post", "/pets")], spec_filename="petstore-mini.json")
    assert "### 201 Created" in md
    assert "`application/json`: [Pet](../schemas/Pet.md)" in md
    assert "### 400 Bad request" in md
    assert "`application/json`: [Error](../schemas/Error.md)" in md


def test_render_endpoint_array_of_ref_in_response(petstore_spec: dict) -> None:
    eps = {(e.method, e.path): e for e in iter_endpoints(petstore_spec)}
    md = render_endpoint(eps[("get", "/pets")], spec_filename="petstore-mini.json")
    assert "`application/json`: array of [Pet](../schemas/Pet.md)" in md


def test_render_endpoint_omits_empty_sections() -> None:
    from docforge.openapi.iter import Endpoint

    ep = Endpoint(method="get", path="/ping", operation={"responses": {"200": {"description": "OK"}}})
    md = render_endpoint(ep, spec_filename="x.json")
    assert "## Parameters" not in md
    assert "## Request Body" not in md
    assert "### 200 OK" in md
