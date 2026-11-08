export type ResourceItem = {
  id: string;
  product: { name: string; kind: string; category?: string };
  quantity: number;
  paymentState: string;
  fulfillmentState: string;
};
export type ResourceOrder = { id: string; items: ResourceItem[] };

export function purchasedResources(orders: ResourceOrder[]) {
  return orders.flatMap((order) =>
    order.items
      .filter(
        (item) =>
          ["digital", "service"].includes(item.product.kind) &&
          ["paid", "escrowed"].includes(item.paymentState),
      )
      .map((item) => ({ ...item, orderId: order.id })),
  );
}

export function resourceReady(item: ResourceItem) {
  return (
    ["digital", "service"].includes(item.product.kind) &&
    item.paymentState === "paid" &&
    item.fulfillmentState === "delivered"
  );
}
