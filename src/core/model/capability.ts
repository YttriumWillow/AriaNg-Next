/**
 * 能力探测：问后端「你到底支持什么」。
 *
 * 为什么要做这件事？
 *  - aria2-next 比原版 aria2 多了一大堆能力（ED2K、HLS/DASH、媒体轨道选择……），
 *    而它又必须兼容原版 aria2 的前端（AriaNg 照样能用）。
 *  - 所以前端不能靠「我假设后端支持」来写代码 —— 得问。
 *
 * 探测手段有三层，从可靠到兜底：
 *  1. `system.listMethods` —— 权威方法清单（aria2-next 文档明确说明）。
 *  2. `aria2.getVersion` 的 product / mediaFeatures / downloadFeatures 字段。
 *  3. 都没有时，退回「尝试调用一次，看是否返回 method not found」。
 */

import type { Aria2Client } from '../rpc/aria2'
import { isMethodNotFound } from '../rpc/errors'

/** 探测出来的后端能力。 */
export interface Capabilities {
  /** 产品标识。aria2-next 返回 "aria2-next"，原版 aria2 返回 "aria2" 或空。 */
  product: string
  version: string
  rpcVersion: string
  /** 是否是 aria2-next（而非原版 aria2） */
  isAria2Next: boolean

  enabledFeatures: string[]
  mediaFeatures: string[]
  downloadFeatures: string[]

  /** 后端支持的全部方法名（来自 system.listMethods）。拿不到时为空数组。 */
  methods: string[]

  /** 供 UI 直接判断的开关 */
  supports: {
    /** ED2K 相关能力 */
    ed2k: boolean
    /** HLS / DASH 媒体能力 */
    media: boolean
    /** BT 扩展方法（getBtTrackers 等） */
    btExtensions: boolean
    /** 链接探测（aria2.probe） */
    probe: boolean
    /** 媒体收尾（aria2.finishMedia） */
    finishMedia: boolean
  }
}

/** 判断后端是否支持某个方法。 */
export function supportsMethod(capabilities: Capabilities, method: string): boolean {
  if (capabilities.methods.length === 0) {
    // 拿不到方法清单时，只有 aria2 标准方法可以假定存在
    return method.startsWith('aria2.') && !isAria2NextOnlyMethod(method)
  }
  return capabilities.methods.includes(method)
}

/**
 * 判断是否属于「只有 aria2-next 才有」的方法。
 * 用于在拿不到方法清单时的保守降级。
 */
function isAria2NextOnlyMethod(method: string): boolean {
  return [
    'aria2.probe',
    'aria2.finishMedia',
    'aria2.retryMedia',
    'aria2.getBtTrackers',
    'aria2.getBtSessionStatus',
    'aria2.getEd2kStatus',
    'aria2.inspectTorrent',
    'aria2.ed2kSearch',
  ].includes(method)
}

/**
 * 执行一次能力探测。
 *
 * 注意分工：
 *  - `getVersion()` 是必选探针，连不上或鉴权失败会抛出异常交给上层处理；
 *  - 其余扩展信息（如 `listMethods`）在不支持时降级兜底，不拖垮整个探测流程。
 */
export async function probeCapabilities(client: Aria2Client): Promise<Capabilities> {
  // 第一步：版本信息（这一步失败说明根本连不上，交给上层处理）
  const version = await client.getVersion()
  const product = version.product ?? ''
  const isAria2Next = product === 'aria2-next'

  const enabledFeatures = version.enabledFeatures ?? []
  const mediaFeatures = version.mediaFeatures ?? []
  const downloadFeatures = version.downloadFeatures ?? []

  // 第二步：方法清单（可能不被支持，失败就降级）
  let methods: string[] = []
  try {
    methods = await client.listMethods()
  } catch {
    methods = []
  }

  const has = (method: string): boolean => {
    if (methods.length > 0) return methods.includes(method)
    return !isAria2NextOnlyMethod(method)
  }

  const capabilities: Capabilities = {
    product,
    version: version.version ?? '',
    rpcVersion: version.rpcVersion ?? '',
    isAria2Next,
    enabledFeatures,
    mediaFeatures,
    downloadFeatures,
    methods,
    supports: {
      ed2k: has('aria2.getEd2kStatus') || has('aria2.ed2kSearch'),
      media: has('aria2.finishMedia') || mediaFeatures.length > 0,
      btExtensions: has('aria2.getBtTrackers') || has('aria2.getBtSessionStatus'),
      probe: has('aria2.probe'),
      finishMedia: has('aria2.finishMedia'),
    },
  }

  return capabilities
}

/**
 * 二次确认：某个扩展方法真的能调用吗？
 *
 * 用于「方法清单里有，但调用时才报错」的情况。
 * 返回 true 表示可用，false 表示后端不支持（而不是网络故障）。
 */
export async function verifyMethod(client: Aria2Client, method: string, params: unknown[] = []): Promise<boolean> {
  try {
    await client.connection.call(method, params)
    return true
  } catch (error) {
    // 只有「方法不存在」才判定为不支持；其它错误（网络、鉴权）不算
    return !isMethodNotFound(error)
  }
}
