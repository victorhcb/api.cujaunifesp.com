import Decimal from "decimal.js";
import { MercadoPagoConfig, Payment } from "mercadopago";
import { v4 as uuid } from "uuid";

import order from "src/models/order";
import paymentMethodsService from "src/services/orders/payment-methods";
import { NotFoundError, ServiceError, ValidationError } from "utils/errors";

async function startPaymentOrder({ orderToPayId, paymentDetails }) {
  const orderToPay = await order.findById(orderToPayId);

  if (!orderToPay) {
    throw new NotFoundError({
      message: "O pedido para pagamento não foi encontrado.",
      action: "Inicie o pagamento com um pedido válido.",
    });
  }

  const orderExpiresAt = new Date(orderToPay.expires_at);
  const now = new Date();

  if (orderToPay.closed_at || now > orderExpiresAt) {
    throw new ValidationError({
      message: "Esse pedido não aceita mais pagamentos.",
      action:
        "Entre em contato com o suporte caso acredite que isso seja um erro.",
      statusCode: 422,
    });
  }

  const avaiableMethods =
    await paymentMethodsService.getAvailablePaymentMethods();

  const selectedMethod = avaiableMethods.find(
    (method) => method.payment_method_id === paymentDetails.payment_method_id,
  );

  if (!selectedMethod) {
    throw new ValidationError({
      message:
        "O método de pagamento escolhido está indisponível ou não existe.",
      action: "Inicie o pagamento com outro método de pagamento.",
      statusCode: 422,
    });
  }

  const orderAmount = new Decimal(orderToPay.amount);
  const additionalFee = new Decimal(selectedMethod.additional_fee);
  const transactionAmount = Decimal.add(orderAmount, additionalFee);
  const maxAllowedAmount = new Decimal(selectedMethod.max_allowed_amount);

  if (transactionAmount.greaterThanOrEqualTo(maxAllowedAmount)) {
    throw new ValidationError({
      message: "Esse método de pagamento não aceita esse valor de pagamento",
      action: "Tente utilizar outro método de pagamento",
      statusCode: 422,
    });
  }

  const paymentToPay = {
    payer: paymentDetails.payer,
    payment_method_id: selectedMethod.payment_method_id,
    installments: paymentDetails.installments || 1,
    transaction_amount: transactionAmount.toNumber(),
    token: paymentDetails.token,
    issuer_id: paymentDetails.issuer_id,
    external_reference: uuid(),
  };

  const paidPayment = await pay(paymentToPay);

  const paymentToCreate = {
    id: paidPayment.external_reference,
    mercado_pago_id: paidPayment.id,
    payer_email: paidPayment.payer.email,
    payment_method_id: paidPayment.payment_method_id,
    payment_type_id: paidPayment.payment_type_id || null,
    installments: paidPayment.installments,
    transaction_amount: paidPayment.transaction_amount,
    additional_fee_amount: additionalFee.toNumber(),
    total_paid_amount: paidPayment.total_paid_amount,
    status: paidPayment.status,
    cause: paidPayment.cause,
    order_id: orderToPayId,
    created_at: paidPayment.date_created,
    approved_at: paidPayment.date_approved || null,
    updated_at: paidPayment.date_last_updated,
  };

  const createdPayment = await order.createPayment(paymentToCreate);

  if (!paidPayment.id) {
    throw new ServiceError({
      message: "Não foi possível processar seu pagamento.",
      action: `Entre em contato com o suporte informado o id ${paidPayment.external_reference}`,
    });
  }

  return createdPayment;
}

async function pay(paymentToPay) {
  const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN,
  });

  const payment = new Payment(client);

  const response = await payment
    .create({
      body: paymentToPay,
      requestOptions: { idempotencyKey: paymentToPay.external_reference },
    })
    .then((result) => result)
    .catch((error) => {
      return {
        ...paymentToPay,
        total_paid_amount: 0,
        mercado_pago_id: null,
        status: "cancelled",
        cause: error.message,
      };
    });

  return response;
}

export default Object.freeze({
  startPaymentOrder,
});
