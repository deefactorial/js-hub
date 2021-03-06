import log from 'loglevel'
import {
  Root,
  LinksResponse,
  ListIpfsPathResponse,
  RootResponse,
  RootRequest,
  ArchiveWatchResponse,
  CreateResponse,
  ListPathItem,
  ListPathResponse,
  ListResponse,
  PullIpfsPathResponse,
  PullPathResponse,
  PushPathResponse,
  CreateRequest,
  LinksRequest,
  ListRequest,
  ListPathRequest,
  ListIpfsPathRequest,
  PushPathRequest,
  PullPathRequest,
  PullIpfsPathRequest,
  RemoveRequest,
  RemovePathRequest,
  ArchiveRequest,
  ArchiveStatusRequest,
  ArchiveWatchRequest,
  ArchiveInfoRequest,
  ArchiveStatusResponse,
  ArchiveInfoResponse,
} from '@textile/buckets-grpc/buckets_pb'
import { APIService, APIServicePushPath } from '@textile/buckets-grpc/buckets_pb_service'
import CID from 'cids'
import { EventIterator } from 'event-iterator'
import nextTick from 'next-tick'
import { grpc } from '@improbable-eng/grpc-web'
import { ContextInterface } from '@textile/context'
import { GrpcConnection } from '@textile/grpc-connection'
import { normaliseInput, File } from './normalize'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const block = require('it-block')

const logger = log.getLogger('buckets-api')

/**
 * The expected result format from pushing a path to a bucket
 */
export interface PushPathResult {
  path: {
    path: string
    cid: CID
    root: CID
    remainder: string
  }
  root: string
}

/**
 * Response from bucket links query.
 */
export type LinksObject = {
  www: string
  ipns: string
  url: string
}

/**
 * Bucket root info
 */
export type RootObject = {
  key: string
  name: string
  path: string
  createdAt: number
  updatedAt: number
  thread: string
}

/**
 * A bucket path item response
 */
export type ListPathItemObject = {
  cid: string
  name: string
  path: string
  size: number
  isDir: boolean
  itemsList: Array<ListPathItemObject>
}

/**
 * A bucket list path response
 */
export type ListPathObject = {
  item?: ListPathItemObject
  root?: RootObject
}

/**
 * Archive status codes
 */
export enum StatusCode {
  STATUS_UNSPECIFIED,
  STATUS_EXECUTING,
  STATUS_FAILED,
  STATUS_DONE,
  STATUS_CANCELED,
}

/**
 * Response of of bucket archive status request.
 */
export type ArchiveStatus = {
  key: string
  status: StatusCode
  failedMsg: string
}

/**
 * Metadata for each deal associated with an archive.
 */
export type ArchiveDealInfo = {
  proposalCid: string
  miner: string
}

/**
 * Response of of bucket info status request.
 */
export type ArchiveInfo = {
  key: string
  cid?: string
  deals: Array<ArchiveDealInfo>
}

/**
 * Bucket create response
 */
export type CreateObject = { seed: Uint8Array; seedCid: string; root?: RootObject; links?: LinksObject }

const convertRootObject = (root: Root): RootObject => {
  return {
    key: root.getKey(),
    name: root.getName(),
    path: root.getPath(),
    createdAt: root.getCreatedAt(),
    updatedAt: root.getUpdatedAt(),
    thread: root.getThread(),
  }
}

const convertRootObjectNullable = (root?: Root): RootObject | undefined => {
  if (!root) return
  return convertRootObject(root)
}

const convertPathItem = (item: ListPathItem): ListPathItemObject => {
  const list = item.getItemsList()
  return {
    cid: item.getCid(),
    name: item.getName(),
    path: item.getPath(),
    size: item.getSize(),
    isDir: item.getIsDir(),
    itemsList: list ? list.map(convertPathItem) : [],
  }
}

const convertPathItemNullable = (item?: ListPathItem): ListPathItemObject | undefined => {
  if (!item) return
  return convertPathItem(item)
}

/**
 * Creates a new bucket.
 * @public
 * @param name Human-readable bucket name. It is only meant to help identify a bucket in a UI and is not unique.
 * @param isPrivate encrypt the bucket contents (default `false`)
 * @example
 * Creates a Bucket called "app-name-files"
 * ```typescript
 * import { Buckets } from '@textile/hub'
 *
 * const create = async (buckets: Buckets) => {
 *     return buckets.create("app-name-files")
 * }
 * ```
 *
 * @internal
 */
export async function bucketsCreate(
  api: GrpcConnection,
  name: string,
  isPrivate = false,
  ctx?: ContextInterface,
): Promise<CreateObject> {
  logger.debug('create request')
  const req = new CreateRequest()
  req.setName(name)
  req.setPrivate(isPrivate)
  const res: CreateResponse = await api.unary(APIService.Create, req, ctx)
  const links = res.getLinks()
  return {
    seed: res.getSeed_asU8(),
    seedCid: res.getSeedCid(),
    root: convertRootObjectNullable(res.getRoot()),
    links: links ? links.toObject() : undefined,
  }
}

/**
 * Returns the bucket root CID
 * @param key Unique (IPNS compatible) identifier key for a bucket.
 *
 * @internal
 */
export async function bucketsRoot(
  api: GrpcConnection,
  key: string,
  ctx?: ContextInterface,
): Promise<RootObject | undefined> {
  logger.debug('root request')
  const req = new RootRequest()
  req.setKey(key)
  const res: RootResponse = await api.unary(APIService.Root, req, ctx)
  return convertRootObjectNullable(res.getRoot())
}

/**
 * Returns a list of bucket links.
 * @param key Unique (IPNS compatible) identifier key for a bucket.
 * @example
 * Generate the HTTP, IPNS, and IPFS links for a Bucket
 * ```typescript
 * import { Buckets } from '@textile/hub'
 *
 * const getLinks = async (buckets: Buckets) => {
 *    const links = buckets.links(bucketKey)
 *    return links.ipfs
 * }
 *
 * const getIpfs = async (buckets: Buckets) => {
 *    const links = buckets.links(bucketKey)
 *    return links.ipfs
 * }
 * ```
 *
 * @internal
 */
export async function bucketsLinks(api: GrpcConnection, key: string, ctx?: ContextInterface): Promise<LinksObject> {
  logger.debug('link request')
  const req = new LinksRequest()
  req.setKey(key)
  const res: LinksResponse = await api.unary(APIService.Links, req, ctx)
  return res.toObject()
}

/**
 * Returns a list of all bucket roots.
 * @example
 * Find an existing Bucket named "app-name-files"
 * ```typescript
 * import { Buckets } from '@textile/hub'
 *
 * const exists = async (buckets: Buckets) => {
 *     const roots = await buckets.list();
 *     return roots.find((bucket) => bucket.name ===  "app-name-files")
 * }
 * ```
 *
 * @internal
 */
export async function bucketsList(api: GrpcConnection, ctx?: ContextInterface): Promise<Array<RootObject>> {
  logger.debug('list request')
  const req = new ListRequest()
  const res: ListResponse = await api.unary(APIService.List, req, ctx)
  const roots = res.getRootsList()
  const map = roots ? roots.map((m) => m).map((m) => convertRootObject(m)) : []
  return map
}

/**
 * Returns information about a bucket path.
 * @param key Unique (IPNS compatible) identifier key for a bucket.
 * @param path A file/object (sub)-path within a bucket.
 *
 * @internal
 */
export async function bucketsListPath(
  api: GrpcConnection,
  key: string,
  path: string,
  ctx?: ContextInterface,
): Promise<ListPathObject> {
  logger.debug('list path request')
  const req = new ListPathRequest()
  req.setKey(key)
  req.setPath(path)
  const res: ListPathResponse = await api.unary(APIService.ListPath, req, ctx)
  return {
    item: convertPathItemNullable(res.getItem()),
    root: convertRootObjectNullable(res.getRoot()),
  }
}

/**
 * listIpfsPath returns items at a particular path in a UnixFS path living in the IPFS network.
 * @param path UnixFS path
 *
 * @internal
 */
export async function bucketsListIpfsPath(
  api: GrpcConnection,
  path: string,
  ctx?: ContextInterface,
): Promise<ListPathItemObject | undefined> {
  logger.debug('list path request')
  const req = new ListIpfsPathRequest()
  req.setPath(path)
  const res: ListIpfsPathResponse = await api.unary(APIService.ListIpfsPath, req, ctx)
  return convertPathItemNullable(res.getItem())
}

/**
 * Pushes a file to a bucket path.
 * @param key Unique (IPNS compatible) identifier key for a bucket.
 * @param path A file/object (sub)-path within a bucket.
 * @param input The input file/stream/object.
 * @param opts Options to control response stream. Currently only supports a progress function.
 * @remarks
 * This will return the resolved path and the bucket's new root path.
 * @example
 * Push a file to the root of a bucket
 * ```typescript
 * import { Buckets } from '@textile/hub'
 *
 * const pushFile = async (content: string, bucketKey: string) => {
 *    const file = { path: '/index.html', content: Buffer.from(content) }
 *    return await buckets.pushPath(bucketKey!, 'index.html', file)
 * }
 * ```
 *
 * @internal
 */
export async function bucketsPushPath(
  api: GrpcConnection,
  key: string,
  path: string,
  input: any,
  opts?: { progress?: (num?: number) => void },
  ctx?: ContextInterface,
) {
  return new Promise<PushPathResult>(async (resolve, reject) => {
    // Only process the first  input if there are more than one
    const source: File | undefined = (await normaliseInput(input).next()).value
    const client = grpc.client<PushPathRequest, PushPathResponse, APIServicePushPath>(APIService.PushPath, {
      host: api.serviceHost,
      transport: api.rpcOptions.transport,
      debug: api.rpcOptions.debug,
    })
    client.onMessage((message) => {
      if (message.hasError()) {
        // Reject on first error
        reject(new Error(message.getError()))
      } else if (message.hasEvent()) {
        const event = message.getEvent()?.toObject()
        if (event?.path) {
          // @todo: Is there an standard library/tool for this step in JS?
          const pth = event.path.startsWith('/ipfs/') ? event.path.split('/ipfs/')[1] : event.path
          const cid = new CID(pth)
          const res: PushPathResult = {
            path: {
              path: `/ipfs/${cid.toString()}`,
              cid: cid,
              root: cid,
              remainder: '',
            },
            root: event.root?.path ?? '',
          }
          resolve(res)
        } else if (opts?.progress) {
          opts.progress(event?.bytes)
        }
      } else {
        reject(new Error('Invalid reply'))
      }
    })
    client.onEnd((code) => {
      if (code === grpc.Code.OK) {
        resolve()
      } else {
        reject(new Error(code.toString()))
      }
    })
    if (source) {
      const head = new PushPathRequest.Header()
      head.setPath(source.path || path)
      head.setKey(key)
      const req = new PushPathRequest()
      req.setHeader(head)
      const metadata = { ...api.context.toJSON(), ...ctx?.toJSON() }
      client.start(metadata)
      client.send(req)

      if (source.content) {
        const process = await block({ size: 4096, noPad: true })
        for await (const chunk of process(source.content)) {
          const buf = chunk.slice()
          const part = new PushPathRequest()
          part.setChunk(buf as Buffer)
          client.send(part)
        }
        client.finishSend()
      }
    }
  })
}

/**
 * Pulls the bucket path, returning the bytes of the given file.
 * @param key Unique (IPNS compatible) identifier key for a bucket.
 * @param path A file/object (sub)-path within a bucket.
 * @param opts Options to control response stream. Currently only supports a progress function.
 *
 * @internal
 */
export function bucketsPullPath(
  api: GrpcConnection,
  key: string,
  path: string,
  opts?: { progress?: (num?: number) => void },
  ctx?: ContextInterface,
): AsyncIterableIterator<Uint8Array> {
  const metadata = { ...api.context.toJSON(), ...ctx?.toJSON() }
  const request = new PullPathRequest()
  request.setKey(key)
  request.setPath(path)
  let written = 0
  const events = new EventIterator<Uint8Array>(({ push, stop, fail }) => {
    const resp = grpc.invoke(APIService.PullPath, {
      host: api.serviceHost,
      transport: api.rpcOptions.transport,
      debug: api.rpcOptions.debug,
      request,
      metadata,
      onMessage: async (res: PullPathResponse) => {
        const chunk = res.getChunk_asU8()
        push(chunk)
        written += chunk.byteLength
        if (opts?.progress) {
          opts.progress(written)
        }
      },
      onEnd: async (status: grpc.Code, message: string, _trailers: grpc.Metadata) => {
        if (status !== grpc.Code.OK) {
          fail(new Error(message))
        }
        stop()
      },
    })
    return () => resp.close()
  })
  const it: AsyncIterableIterator<Uint8Array> = {
    [Symbol.asyncIterator]() {
      return this
    },
    ...events[Symbol.asyncIterator](),
  }
  return it
}

/**
 * pullIpfsPath pulls the path from a remote UnixFS dag, writing it to writer if it's a file.
 * @param path A file/object (sub)-path within a bucket.
 * @param opts Options to control response stream. Currently only supports a progress function.
 *
 * @internal
 */
export function bucketsPullIpfsPath(
  api: GrpcConnection,
  path: string,
  opts?: { progress?: (num?: number) => void },
  ctx?: ContextInterface,
): AsyncIterableIterator<Uint8Array> {
  const metadata = { ...api.context.toJSON(), ...ctx?.toJSON() }
  const request = new PullIpfsPathRequest()
  request.setPath(path)
  let written = 0
  const events = new EventIterator<Uint8Array>(({ push, stop, fail }) => {
    const resp = grpc.invoke(APIService.PullIpfsPath, {
      host: api.serviceHost,
      transport: api.rpcOptions.transport,
      debug: api.rpcOptions.debug,
      request,
      metadata,
      onMessage: async (res: PullIpfsPathResponse) => {
        const chunk = res.getChunk_asU8()
        push(chunk)
        written += chunk.byteLength
        if (opts?.progress) {
          opts.progress(written)
        }
      },
      onEnd: async (status: grpc.Code, message: string, _trailers: grpc.Metadata) => {
        if (status !== grpc.Code.OK) {
          fail(new Error(message))
        }
        stop()
      },
    })
    return () => resp.close()
  })
  const it: AsyncIterableIterator<Uint8Array> = {
    [Symbol.asyncIterator]() {
      return this
    },
    ...events[Symbol.asyncIterator](),
  }
  return it
}

/**
 * Removes an entire bucket. Files and directories will be unpinned.
 * @param key Unique (IPNS compatible) identifier key for a bucket.
 *
 * @internal
 */
export async function bucketsRemove(api: GrpcConnection, key: string, ctx?: ContextInterface) {
  logger.debug('remove request')
  const req = new RemoveRequest()
  req.setKey(key)
  await api.unary(APIService.Remove, req, ctx)
  return
}

/**
 * Returns information about a bucket path.
 * @param key Unique (IPNS compatible) identifier key for a bucket.
 * @param path A file/object (sub)-path within a bucket.
 * @param root optional to specify a root
 *
 * @internal
 */
export async function bucketsRemovePath(
  api: GrpcConnection,
  key: string,
  path: string,
  root?: string,
  ctx?: ContextInterface,
) {
  logger.debug('remove path request')
  const req = new RemovePathRequest()
  req.setKey(key)
  req.setPath(path)
  if (root) req.setRoot(root)
  await api.unary(APIService.RemovePath, req, ctx)
  return
}

/**
 * archive creates a Filecoin bucket archive via Powergate.
 * @internal
 * @param key Unique (IPNS compatible) identifier key for a bucket.
 */
export async function bucketsArchive(api: GrpcConnection, key: string, ctx?: ContextInterface) {
  logger.debug('archive request')
  const req = new ArchiveRequest()
  req.setKey(key)
  await api.unary(APIService.Archive, req, ctx)
  return
}

/**
 * archiveStatus returns the status of a Filecoin bucket archive.
 * @internal
 * @param key Unique (IPNS compatible) identifier key for a bucket.
 */
export async function bucketsArchiveStatus(
  api: GrpcConnection,
  key: string,
  ctx?: ContextInterface,
): Promise<ArchiveStatus> {
  logger.debug('archive status request')
  const req = new ArchiveStatusRequest()
  req.setKey(key)
  const res: ArchiveStatusResponse = await api.unary(APIService.ArchiveStatus, req, ctx)
  return {
    key: res.getKey(),
    status: res.getStatus(),
    failedMsg: res.getFailedMsg(),
  }
}

/**
 * archiveInfo returns info about a Filecoin bucket archive.
 * @internal
 * @param key Unique (IPNS compatible) identifier key for a bucket.
 */
export async function bucketsArchiveInfo(
  api: GrpcConnection,
  key: string,
  ctx?: ContextInterface,
): Promise<ArchiveInfo> {
  logger.debug('archive info request')
  const req = new ArchiveInfoRequest()
  req.setKey(key)
  const res: ArchiveInfoResponse = await api.unary(APIService.ArchiveInfo, req, ctx)
  const archive = res.getArchive()
  const deals = archive ? archive.getDealsList() : []
  return {
    key: res.getKey(),
    cid: archive ? archive.getCid() : undefined,
    deals: deals.map((d) => {
      return {
        proposalCid: d.getProposalCid(),
        miner: d.getMiner(),
      }
    }),
  }
}

/**
 * archiveWatch watches status events from a Filecoin bucket archive.
 * @internal
 * @param key Unique (IPNS compatible) identifier key for a bucket.
 */
export async function bucketsArchiveWatch(
  api: GrpcConnection,
  key: string,
  callback: (reply?: { id: string | undefined; msg: string }, err?: Error) => void,
  ctx?: ContextInterface,
) {
  logger.debug('archive watch request')
  const req = new ArchiveWatchRequest()
  req.setKey(key)

  const metadata = { ...api.context.toJSON(), ...ctx?.toJSON() }
  const res = grpc.invoke(APIService.ArchiveWatch, {
    host: api.context.host,
    request: req,
    metadata,
    onMessage: (rec: ArchiveWatchResponse) => {
      const response = {
        id: rec.getJsPbMessageId(),
        msg: rec.getMsg(),
      }
      nextTick(() => callback(response))
    },
    onEnd: (status: grpc.Code, message: string, _trailers: grpc.Metadata) => {
      if (status !== grpc.Code.OK) {
        return callback(undefined, new Error(message))
      }
      callback()
    },
  })
  return res.close.bind(res)
}
