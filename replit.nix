{ pkgs }: {
  deps = [
    pkgs.nodejs-lts
    (pkgs.python311.withPackages (ps: [ ps.pip ]))
  ];
}
