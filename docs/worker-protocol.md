# Remote worker protocol

The orchestrator treats a remote worker as a narrow experiment executor. It never sends shell commands, arbitrary code, credentials, or datasets. A worker implementation must independently allowlist container images, datasets, and experiment fields.

The repository includes a real, bounded reference implementation in [`worker/`](../worker/README.md) for `cifar10-small-v1`.

## Registration configuration

Provide worker metadata to `RemoteWorker` in trusted server configuration, never from a browser request:

```js
new RemoteWorker({
  id: 'gpu-lab-02',
  endpoint: 'https://worker.example/execute',
  capabilities: ['cpu', 'gpu'],
  token: process.env.WORKER_TOKEN,
})
```

## Request

`POST /execute` receives JSON with an `experiment` object containing only an ID, a named allowlisted configuration, a metric name, and a bounded epoch limit. If configured, the request carries `Authorization: Bearer <token>`.

## Response

Return HTTP 200 with this shape:

```json
{
  "metrics": { "dice_score": 0.83, "epochs": 8, "simulated": false }
}
```

The orchestrator rejects non-numeric requested metrics. A production worker should persist artifacts by experiment ID, make retries idempotent, report heartbeats, enforce time/memory limits, and use mTLS or an equivalent workload identity.
