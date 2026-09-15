/** The source explicitly marks this as information, not a sellable item.
 * A zero price by itself is valid (gifts and weight-priced products use it).
 */
export function isPosSellableItem(item: { name: string }) {
  return !item.name.includes("こちら商品ではありません");
}
