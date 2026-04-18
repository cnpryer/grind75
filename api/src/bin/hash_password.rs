use api::auth::password;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 2 {
        eprintln!("Usage: hash-password <password>");
        std::process::exit(2);
    }

    match password::hash_password(&args[1]) {
        Ok(hash) => println!("{hash}"),
        Err(e) => {
            eprintln!("Hashing failed: {e}");
            std::process::exit(1);
        }
    }
}
