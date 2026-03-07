export function extractBearerToken(
  authorizationHeader: string | string[] | undefined,
): string | undefined {
  const headerValue = Array.isArray(authorizationHeader)
    ? authorizationHeader[0]
    : authorizationHeader;

  if (typeof headerValue !== 'string') {
    return undefined;
  }

  const [scheme, token, ...rest] = headerValue.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer' || !token || rest.length > 0) {
    return undefined;
  }

  return token;
}
