import argparse
import json
import logging
from pathlib import Path

from .iter import iter_endpoints, iter_schemas
from .loader import UnsupportedSpecError, load_spec
from .paths import (
    SlugCollisionError,
    detect_endpoint_collisions,
    endpoint_filename,
    schema_filename,
)
from .render import render_endpoint, render_schema

log = logging.getLogger("docforge.openapi")


def build_openapi_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="docforge openapi",
        description="Convert an OpenAPI 3.x spec into per-endpoint + per-schema Markdown.",
    )
    parser.add_argument("spec", help="path to OpenAPI 3.x JSON or YAML spec file")
    parser.add_argument("--output", required=True, help="output directory")
    return parser


def add_openapi_subparser(subparsers: argparse._SubParsersAction) -> None:
    sp = subparsers.add_parser(
        "openapi",
        help="Convert an OpenAPI 3.x spec to Markdown",
        description="Convert an OpenAPI 3.x spec into per-endpoint + per-schema Markdown.",
    )
    sp.add_argument("spec", help="path to OpenAPI 3.x JSON or YAML spec file")
    sp.add_argument("--output", required=True, help="output directory")
    sp.set_defaults(func=run_openapi)


def run_openapi(args: argparse.Namespace) -> int:
    spec_path = Path(args.spec).expanduser()
    output = Path(args.output).expanduser()

    if not spec_path.is_file():
        log.error("spec not found: %s", spec_path)
        return 2

    try:
        spec = load_spec(spec_path)
    except UnsupportedSpecError as e:
        log.error("%s", e)
        return 2
    except (json.JSONDecodeError, ValueError) as e:
        log.error("failed to parse %s: %s", spec_path, e)
        return 2

    endpoints_dir = output / "endpoints"
    schemas_dir = output / "schemas"
    endpoints_dir.mkdir(parents=True, exist_ok=True)
    schemas_dir.mkdir(parents=True, exist_ok=True)

    endpoints = list(iter_endpoints(spec))
    schemas = list(iter_schemas(spec))

    try:
        detect_endpoint_collisions([(e.method, e.path) for e in endpoints])
    except SlugCollisionError as e:
        log.error("%s", e)
        return 2

    spec_filename = spec_path.name

    for ep in endpoints:
        out_path = endpoints_dir / endpoint_filename(ep.method, ep.path)
        out_path.write_text(render_endpoint(ep, spec_filename=spec_filename), encoding="utf-8")

    for sc in schemas:
        out_path = schemas_dir / schema_filename(sc.name)
        out_path.write_text(render_schema(sc, spec_filename=spec_filename), encoding="utf-8")

    log.info("endpoints=%d  schemas=%d", len(endpoints), len(schemas))
    return 0
