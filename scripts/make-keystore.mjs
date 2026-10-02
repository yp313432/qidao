#!/usr/bin/env node
/**
 * 生成安卓签名文件（PKCS#12）。
 *
 * 为什么必须固定一个签名：
 *   安卓按「包名 + 签名」认应用。每次构建都换签名的话，装新版必须先卸载，
 *   一卸载 App 内部数据（日记、信、设置）就全没了。
 *   签名固定 → 新版直接覆盖安装 → **数据保留** ✅
 *
 * 为什么用 node-forge 而不是 keytool：
 *   这台机器没有 Java。node-forge 是纯 JS，能直接写出 PKCS#12。
 *
 * 这个文件**只跑一次**。生成后把它（base64）放进 GitHub Secret，
 * 由 CI 在构建时还原 —— 签名文件不进仓库（公开仓库里放签名密钥等于把
 * 「冒充栖岛」的钥匙挂出去）。
 *
 * 用法：node scripts/make-keystore.mjs
 */
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import forge from "node-forge";

const OUT = process.env.KEYSTORE_OUT ?? "android/qidao-release.p12";
const PASSWORD = process.env.KEYSTORE_PASSWORD ?? "qidao-release-2026";
const ALIAS = process.env.KEYSTORE_ALIAS ?? "qidao";

if (existsSync(OUT) && !process.env.FORCE) {
  console.log(`[keystore] ${OUT} 已存在，不覆盖（要重做就设 FORCE=1）。`);
  process.exit(0);
}

console.log("[keystore] 生成 RSA 2048 密钥对…");
const keys = forge.pki.rsa.generateKeyPair(2048);

console.log("[keystore] 自签证书（有效期 30 年）…");
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = "01" + Date.now().toString(16);
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 30);

const attrs = [
  { name: "commonName", value: "Qidao" },
  { name: "organizationName", value: "Qidao Personal" },
  { shortName: "OU", value: "Self" },
  { name: "countryName", value: "CN" },
];
cert.setSubject(attrs);
cert.setIssuer(attrs);
cert.sign(keys.privateKey, forge.md.sha256.create());

console.log("[keystore] 打包成 PKCS#12…");
const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], PASSWORD, {
  algorithm: "3des",
  friendlyName: ALIAS,
});
const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
const buf = Buffer.from(p12Der, "binary");

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, buf);

console.log(`[keystore] 已写出 ${OUT}（${Math.round(buf.length / 1024)} KB）`);
console.log(`[keystore] 别名=${ALIAS}  口令=${PASSWORD}`);
console.log("");
console.log("下一步：把它的 base64 放进 GitHub Secret（名字：ANDROID_KEYSTORE_BASE64）");
