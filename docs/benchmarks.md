# Structured benchmark definitions

These definitions make research plans reproducible before a real worker is available. They are configurations and data contracts, not bundled datasets or validated benchmark results.

| Profile | Benchmark ID | Dataset ID | Task | Current status |
| --- | --- | --- | --- | --- |
| Vision | `cifar10-small-v1` | `cifar-10` | Image classification | Not configured in the demo worker |
| Segmentation | `brats-limited-v1` | `brats-user-provided` | 3D brain-tumor segmentation | Requires user-provided/licensed data |
| Transformer | `ag-news-small-v1` | `ag-news` | Text classification | Not configured in the demo worker |

Each execution must record the exact dataset release, split manifest, preprocessing version, container image, source revision, and seed once real workers are connected. The system must not claim results from these benchmarks until the worker provides those provenance fields and real metrics.
