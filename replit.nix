{ pkgs }: {
  deps = [
    pkgs.nodejs
    (pkgs.python3.withPackages (ps: [ ps.pip ]))
  ];
}
