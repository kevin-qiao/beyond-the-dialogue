import type { Destination } from '../../../shared/types'
import type { ArtifactStorePort } from '../../../core/ports/artifactStore'
import { folderArtifactStore } from './folderStore'
import { wikiArtifactStoreFor } from './wikiStore'

// The destination → store lookup. One place maps a `store` value to its
// adapter, so adding a storage location is a new entry here plus an
// implementation — the finish service never learns about either.

export function artifactStoreFor(wikiRoot: string) {
  return (dest: Destination): ArtifactStorePort => {
    if (dest.store === 'wiki') return wikiArtifactStoreFor(wikiRoot)
    return folderArtifactStore
  }
}
