/**
 * RPC 客户端注册表。
 *
 * 为什么单独抽一个模块？
 * 因为 hosts store（管连接）和 tasks store（管任务数据）都需要拿到客户端，
 * 如果互相 import 就会形成循环依赖。
 * 把「非响应式的运行时对象」放进一个普通模块，两个 store 都依赖它，
 * 依赖方向就是单向的了。
 *
 * 注意：这里存的是**运行时对象**，不能被序列化到 localStorage，
 * 所以刻意不放进 Pinia state。
 */

import { Aria2Client } from './aria2'

const clients = new Map<string, Aria2Client>()

/** 登记某个主机的客户端。 */
export function setClient(hostId: string, client: Aria2Client): void {
  clients.set(hostId, client)
}

/** 取某个主机的客户端；没有连接时返回 undefined。 */
export function getClient(hostId: string): Aria2Client | undefined {
  return clients.get(hostId)
}

/** 移除某个主机的客户端。 */
export function removeClient(hostId: string): void {
  clients.delete(hostId)
}

/** 当前已连接的客户端数量。 */
export function clientCount(): number {
  return clients.size
}
