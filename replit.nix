{ pkgs }: {
  deps = [
    pkgs.nodejs_20
    (pkgs.python311.withPackages (ps: [ ps.pip ]))
  ];
}
