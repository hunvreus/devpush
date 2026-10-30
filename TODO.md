# TODO

- Recover open browser tabs when an app update replaces server-function bundles.
- Load-test concurrent deployments, log ingestion and database recovery on D1/libSQL.
- Preserve generated deployment URLs across server IP changes.
- Provide operator recovery for rejected completion records and orphaned log captures.
- Detect log gaps caused by Docker rotation.
- Verify backup storage with an upload/read/delete probe.
- Complete custom-domain, repository, avatar and server-enrollment operations with matching permissions and safe retries.
- Benchmark idle polling and scheduled maintenance on Workers with one, three and five servers before further tuning.
- Stop completed operation-log polling once the agent reliably confirms that the final log bytes have uploaded.
