export default Object.freeze({
  "GET:CURRENT_SELECTION": {
    allowUnauthenticated: true,
    verifier: (session, resource) => true,
  },

  "POST:APPLICATIONS": {
    allowUnauthenticated: false,
    verifier: (session, resource) => {
      if (
        session.email &&
        resource?.email &&
        resource?.email === session.email
      ) {
        return true;
      }
    },
  },
});
