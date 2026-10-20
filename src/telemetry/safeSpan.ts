/** Keep instrumentation failures from replacing business results or exceptions. */
import { trace, INVALID_SPAN_CONTEXT } from '@opentelemetry/api';
import type { Span, SpanOptions } from '@opentelemetry/api';

export function safeSpan(scope: string, name: string, options: SpanOptions): Span {
  let span: Span;
  try { span = trace.getTracer(scope).startSpan(name, options); }
  catch { span = trace.wrapSpanContext(INVALID_SPAN_CONTEXT); }
  // SDK processors and custom providers may throw on start, mutation or end.
  // A non-recording fallback still lets the business callback execute once.
  const fallback = trace.wrapSpanContext(INVALID_SPAN_CONTEXT);
  return new Proxy(span, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        try { return Reflect.apply(value, target, args); }
        catch {
          const noop = Reflect.get(fallback, key);
          return typeof noop === 'function' ? Reflect.apply(noop, fallback, args) : undefined;
        }
      };
    },
  });
}
