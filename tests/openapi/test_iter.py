from docforge.openapi.iter import Endpoint, Schema, iter_endpoints, iter_schemas


def test_iter_endpoints_yields_each_method_per_path(petstore_spec: dict) -> None:
    eps = list(iter_endpoints(petstore_spec))
    keys = {(e.method, e.path) for e in eps}
    assert keys == {("get", "/pets"), ("post", "/pets"), ("get", "/pets/{id}")}


def test_iter_endpoints_record_shape(petstore_spec: dict) -> None:
    eps = {(e.method, e.path): e for e in iter_endpoints(petstore_spec)}
    get_pets = eps[("get", "/pets")]
    assert isinstance(get_pets, Endpoint)
    assert get_pets.summary == "List pets"
    assert get_pets.tags == ["pets"]
    assert get_pets.operation["responses"]["200"]["description"] == "OK"


def test_iter_endpoints_skips_non_method_keys(petstore_spec: dict) -> None:
    petstore_spec["paths"]["/pets"]["parameters"] = [
        {"name": "x-trace", "in": "header", "schema": {"type": "string"}}
    ]
    methods = {e.method for e in iter_endpoints(petstore_spec) if e.path == "/pets"}
    assert methods == {"get", "post"}


def test_iter_schemas_yields_each_component(petstore_spec: dict) -> None:
    names = {s.name for s in iter_schemas(petstore_spec)}
    assert names == {"Pet", "NewPet", "Owner", "Error"}


def test_iter_schemas_record_shape(petstore_spec: dict) -> None:
    schemas = {s.name: s for s in iter_schemas(petstore_spec)}
    pet = schemas["Pet"]
    assert isinstance(pet, Schema)
    assert pet.body["type"] == "object"
    assert "id" in pet.body["properties"]


def test_iter_schemas_empty_when_no_components() -> None:
    spec = {"openapi": "3.0.0", "paths": {}}
    assert list(iter_schemas(spec)) == []
