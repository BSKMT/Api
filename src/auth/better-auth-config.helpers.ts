export const USER_ADDITIONAL_FIELDS = {
  role: {
    type: "string",
    defaultValue: "user",
    input: false,
    required: false,
  },
  username: {
    type: "string",
    defaultValue: "",
    input: true,
    required: false,
  },
  primerNombre: {
    type: "string",
    defaultValue: "",
    input: true,
    required: false,
  },
  segundoNombre: {
    type: "string",
    defaultValue: "",
    input: true,
    required: false,
  },
  primerApellido: {
    type: "string",
    defaultValue: "",
    input: true,
    required: false,
  },
  segundoApellido: {
    type: "string",
    defaultValue: "",
    input: true,
    required: false,
  },
  country: {
    type: "string",
    defaultValue: "",
    input: true,
    required: false,
  },
  birthDate: {
    type: "string",
    defaultValue: "",
    input: true,
    required: false,
  },
} as const;

export function getTrustedOrigins(): string[] {
  if (process.env.NODE_ENV === "production") {
    return [
      "https://bskmt.com",
      "https://www.bskmt.com",
      "https://dash.bskmt.com",
      "https://console.bskmt.com",
      "https://panel.bskmt.com",
      "https://super.bskmt.com",
    ];
  }
  return [
    "https://bskmt.com",
    "https://dash.bskmt.com",
    "https://console.bskmt.com",
    "https://panel.bskmt.com",
    "https://super.bskmt.com",
    "http://localhost:3000",
    "http://localhost:4321",
    "http://localhost:4322",
    "http://localhost:4323",
    "http://localhost:4324",
    "http://localhost:4325",
  ];
}

export function getPasskeyOrigins(): string[] {
  if (process.env.NODE_ENV === "production") {
    return [
      "https://bskmt.com",
      "https://dash.bskmt.com",
      "https://console.bskmt.com",
      "https://panel.bskmt.com",
      "https://super.bskmt.com",
    ];
  }
  return [
    "https://bskmt.com",
    "https://dash.bskmt.com",
    "https://console.bskmt.com",
    "https://panel.bskmt.com",
    "https://super.bskmt.com",
    "http://localhost:3000",
    "http://localhost:4321",
    "http://localhost:4322",
    "http://localhost:4323",
    "http://localhost:4324",
    "http://localhost:4325",
  ];
}
