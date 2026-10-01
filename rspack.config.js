import nodeExternals from "webpack-node-externals";

export default function configureRspack(options) {
  return {
    ...options,
    externals: [
      nodeExternals({
        importType: "module",
        allowlist: ["@nestjs/throttler"],
      }),
      ...(options.externals?.slice(1) || []),
    ],
  };
}
