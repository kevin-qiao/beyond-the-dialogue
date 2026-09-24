import type { Destination } from '../../../shared/types'
import type { ArtifactStorePort } from '../../../core/ports/artifactStore'
import { folderArtifactStore } from './folderStore'
import { wikiArtifactStoreFor } from './wikiStore'

// The destination → store lookup. One place maps a `store` value to its
// adapter, so adding a storage location is a new entry here plus an
// implementation — the finish service never learns about either.

// The wiki store is built from the DESTINATION's own root: every type that
// files into the wiki declares its directory, and there is no global wiki
// location to bind here. A blank root reaches `prepare()` as a refusal.
export function artifactStoreFor() {
  return (dest: Destination): ArtifactStorePort => {
    if (dest.store === 'wiki') return wikiArtifactStoreFor((dest.rootPath ?? '').trim())
    return folderArtifactStore
  }
}
