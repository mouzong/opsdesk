# Errors and status codes

Every error response has the same JSON shape and a request id you can quote when reporting problems or searching the server log:

```json
{
  "error": {
    "code": "validation_error",
    "message": "url: Only http:// and https:// URLs are allowed.",
    "fields": { "url": "Only http:// and https:// URLs are allowed." },
    "requestId": "5b0f2a1e-0000-4000-8000-00000000abcd"
  }
}
```

| Field | Meaning |
| --- | --- |
| `code` | Stable, machine-readable. Branch on this, not on `message`. |
| `message` | Human-readable and safe: never contains credentials, URLs of databases, stack traces or raw database errors. |
| `fields` | Only for validation errors: message per field (`title`, `tags`, `Idempotency-Key`, `file`, ...). |
| `requestId` | Identical to the `X-Request-Id` response header. |

The only response that is **not** this shape is `GET /health` with status `503`, which returns the [health report](../operations/health.md).

## Status codes

| Status | Codes | Typical cause |
| --- | --- | --- |
| **200** | - | Success (reads, edits, moves, deletes, imports). |
| **201** | - | Created; body is the resource, `Location` points to it. |
| **204** | - | CORS pre-flight from a configured origin. |
| **400** | `validation_error`, `invalid_request`, `bad_json`, `bad_multipart`, `confirmation_required`, `nothing_to_import`, `unsupported_version`, `limit_reached`, `invalid_name`, `invalid_backup` | Invalid or out-of-range input; missing destructive confirmation (`confirmReplace`, `confirm`); unusable import file; a limit was reached. Nothing was changed. |
| **401** | `authentication_required`, `invalid_authorization`, `api_auth_not_configured`, `invalid_token` | Missing, malformed or wrong credentials; token access not enabled on the server. |
| **403** | `host_not_allowed`, `bad_origin`, `cross_site`, `cross_origin_requires_token`, `csrf`, `https_required` | Host/origin/CSRF protections; token sent over plain HTTP to a non-local host name. |
| **404** | `not_found` | Unknown resource or endpoint; deleting something twice. |
| **405** | `method_not_allowed` | Pre-flight from an origin that is not configured. |
| **409** | `conflict`, `not_supported` | Non-empty group/workspace deleted without `mode`; setup already completed; backups on PostgreSQL/MySQL. |
| **412** | `precondition_failed` | `If-Match` no longer matches: re-read and retry. Nothing was changed. |
| **413** | `too_large` | Body or file over the limit. |
| **415** | `unsupported_media_type` | Wrong `Content-Type`; multipart sent without a bearer token or to an endpoint that does not accept it. |
| **422** | `idempotency_key_reuse` | The `Idempotency-Key` was already used with a different request. |
| **429** | `too_many_requests` | Too many failed token attempts; wait for `Retry-After` seconds. |
| **500** | `internal`, `restore_failed` | Unexpected error. The request id lets an operator find it in the log. |
| **503** | - | `GET /health` is red. |

## Validation details

Validation is performed on the server for every request. Typical `fields` keys:

| Field | Rule |
| --- | --- |
| `title` | 1-120 characters (workspace/group `name`: 1-80; dashboard title 1-60) |
| `url` | `http://` or `https://`, at most 2048 characters, no spaces, **no embedded `user:password@`** |
| `description` / `note` / `owner` | at most 500 / 4000 / 80 characters |
| `tags` | at most 20, each at most 32 characters; duplicates and commas removed |
| `environment` | `production`, `preproduction`, `staging`, `development`, `lab`, `other` |
| `icon` | one of the bundled icon names (see the schema enum) |
| `index` | integer 0-100000 |

Control characters are stripped from text fields. HTML in text is stored and returned as plain text.

## Retrying

| Status | Retry? |
| --- | --- |
| `5xx`, network errors | Yes. Use an `Idempotency-Key` for creating operations (see [Concurrency, retries and idempotency](index.md#concurrency-retries-and-idempotency)). |
| `429` | After `Retry-After`. |
| `412` | Fetch the resource again, merge, resend with the new `ETag`. |
| `400`, `401`, `403`, `404`, `409`, `413`, `415`, `422` | No: fix the request first. |

## Inspecting failures with curl

`--fail-with-body` (curl 7.76+) gives a non-zero exit code **and** prints the body; `-i` shows headers (including `X-Request-Id`); `-w '%{http_code}'` prints just the status. Examples: [cookbook, section 15](cookbook.md#15-inspect-http-failures).
