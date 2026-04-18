use argon2::password_hash::{PasswordHasher, SaltString, rand_core::OsRng};
use argon2::Argon2;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 2 {
        eprintln!("Usage: hash-password <password>");
        std::process::exit(2);
    }

    let password = &args[1];
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();

    match argon2.hash_password(password.as_bytes(), &salt) {
        Ok(hash) => println!("{hash}"),
        Err(e) => {
            eprintln!("Hashing failed: {e}");
            std::process::exit(1);
        }
    }
}
