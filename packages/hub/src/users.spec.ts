;(global as any).WebSocket = require("isomorphic-ws")

import { Buckets } from "@textile/buckets"
import { Context } from "@textile/context"
import { SignupReply } from "@textile/hub-grpc/hub_pb"
import { Client } from "@textile/hub-threads-client"
import { Libp2pCryptoIdentity } from "@textile/threads-core"
import { ThreadID } from "@textile/threads-id"
import { isBrowser } from "browser-or-node"
import { expect } from "chai"
import fs from "fs"
import path from "path"
import { createKey, signUp } from "./spec.util"

// Settings for localhost development and testing
const addrApiurl = "http://127.0.0.1:3007"
const addrGatewayUrl = "http://127.0.0.1:8006"
const sessionSecret = "hubsession"

describe("Users...", () => {
  describe("Buckets and accounts", () => {
    context("a developer", () => {
      const ctx = new Context(addrApiurl)
      let dev: SignupReply.AsObject
      it("should sign-up, create an API key, and sign it for the requests", async () => {
        // @note This should be done using the cli
        const { user } = await signUp(ctx, addrGatewayUrl, sessionSecret)
        if (user) dev = user
        // @note This should be done using the cli
        ctx.withSession(dev.session)
        const key = await createKey(ctx, "ACCOUNT")
        await ctx.withAPIKey(key.key).withKeyInfo(key)
        expect(ctx.toJSON()).to.have.ownProperty("x-textile-api-sig")
      }).timeout(3000)
      it("should then create a db for the bucket", async () => {
        const db = new Client(ctx)
        const id = ThreadID.fromRandom()
        await db.newDB(id, "my-buckets")
        expect(ctx.toJSON()).to.have.ownProperty("x-textile-thread-name")
      })
      it("should then initialize a new bucket in the db and push to it", async function () {
        if (isBrowser) return this.skip()
        // Initialize a new bucket in the db
        const buckets = new Buckets(ctx)
        const buck = await buckets.init("mybuck")
        expect(buck.root?.name).to.equal("mybuck")

        // Finally, push a file to the bucket.
        const pth = path.join(__dirname, "../../..", "testdata")
        const stream = fs.createReadStream(path.join(pth, "file1.jpg"))
        const rootKey = buck.root?.key || ""
        const { root } = await buckets.pushPath(
          rootKey,
          "dir1/file1.jpg",
          stream
        )
        expect(root).to.not.be.undefined

        // We should have a thread named "my-buckets"
        const users = new Client(ctx)
        const res = await users.getThread("my-buckets")
        expect(res.id).to.deep.equal(ctx.toJSON()["x-textile-thread"])
      })
    })
    context("a developer with a user", function () {
      this.timeout(5000)
      const ctx = new Context(addrApiurl)
      let dev: SignupReply.AsObject
      let users: Client
      it("should sign-up, create an API key, and a new user", async function () {
        // @note This should be done using the cli
        const { user } = await signUp(ctx, addrGatewayUrl, sessionSecret)
        if (user) dev = user
        // @note This should be done using the cli
        // This time they create a user key
        const key = await createKey(ctx.withSession(dev.session), "USER")

        // This should automatically generate a user identity and validate keys, though we use a random ident
        // for demo purposes here to show that it can also use custom identities
        const identity = await Libp2pCryptoIdentity.fromRandom()
        // We also explicitly specify a custom context here, which could be omitted as it uses reasonable defaults
        const userContext = await new Context(addrApiurl).withKeyInfo(key)
        // In the app, we simply create a new user from the provided user key, signing is done automatically
        users = new Client(userContext)
        await users.getToken(identity)
        expect(users.context.toJSON()).to.have.ownProperty("x-textile-api-sig")
      }).timeout(3000)

      it("should then create a db for the bucket", async function () {
        // @todo https://github.com/textileio/js-threads/pull/263 should fix this...
        await users.newDB(ThreadID.fromRandom(), "my-buckets")
        expect(users.context.toJSON()).to.have.ownProperty(
          "x-textile-thread-name"
        )
      })

      it("should then initialize a new bucket in the db and push to it", async function () {
        if (isBrowser) return this.skip()
        // Initialize a new bucket in the db from the user context
        const buckets = new Buckets(users.context)
        const buck = await buckets.init("mybuck")
        expect(buck.root?.name).to.equal("mybuck")

        // Finally, push a file to the bucket.
        const pth = path.join(__dirname, "../../..", "testdata")
        const stream = fs.createReadStream(path.join(pth, "file1.jpg"))
        const rootKey = buck.root?.key || ""
        const { root } = await buckets.pushPath(
          rootKey,
          "dir1/file1.jpg",
          stream
        )
        expect(root).to.not.be.undefined

        // Ensure context is set properly
        expect(users.context.toJSON()).to.have.ownProperty(
          "x-textile-thread-name"
        )
        expect(users.context.get("x-textile-thread-name")).to.equal(
          "my-buckets"
        )

        // We should have a thread named "my-buckets"
        const res = await users.getThread("my-buckets")
        expect(res.id).to.deep.equal(users.context.toJSON()["x-textile-thread"])

        // The dev should see that the key was used to create one thread
        // @todo: Use the cli to list keys
      })
    })
  })
})
