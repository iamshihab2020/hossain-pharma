import Lottie from "lottie-react";
import logAnimation from "../../../../assets/lottie/log.json";
import { Card, Input, Button, Typography } from "@material-tailwind/react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import SyncHelmet from "../../Shared/Helmet/SyncHelmet";
import Swal from "sweetalert2";
import { useContext } from "react";
import { AuthContext } from "../../../providers/AuthProvider";
import SocialLogin from "../../Shared/SocialLogin/SocialLogin";

const Login = () => {
  const {
    register,
    handleSubmit,
    // watch,
    formState: { errors },
  } = useForm();
  const { signIn } = useContext(AuthContext);
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from?.pathname || "/";

  const onSubmit = async (data) => {
    try {
      const { email, password } = data;
      const userCredential = await signIn(email, password);
      if (userCredential) {
        Swal.fire({
          position: "top-end",
          icon: "success",
          title: "You have been successfully signed in",
          showConfirmButton: false,
          timer: 2000,
        }).then(() => {
          navigate(from, { replace: true });
        });
      }
    } catch (error) {
      console.error("Error:", error);
      Swal.fire({
        position: "top-end",
        icon: "error",
        title: "There was an error while logging into your account",
        showConfirmButton: true,
      });
    }
  };

  

  return (
    <>
      <SyncHelmet loc={"Log In"} />
      <div className="min-h-screen mt-10 p-2  ">
        <div className="flex items-center justify-around flex-col lg:flex-row p-10 ">
          <div className=" hidden lg:block ">
            <Lottie animationData={logAnimation} />
          </div>
          <div>
            <Card color="transparent" shadow={false}>
              <Typography
                variant="h4"
                className="text-center text-[#3DBDEC] sm:text-3xl lg:text-4xl"
              >
                Log In
              </Typography>

              <form
                className="mt-8 mb-2 w-80 max-w-screen-lg sm:w-96 px-5"
                onSubmit={handleSubmit(onSubmit)}
              >
                <div className="mb-1 flex flex-col gap-6">
                  <Typography variant="h6" color="blue-gray" className="-mb-3">
                    Your Email
                  </Typography>
                  <Input
                    size="lg"
                    name="email"
                    placeholder="name@mail.com"
                    className="border-t-blue-gray-200 focus:border-t-gray-900"
                    labelProps={{
                      className: "before:content-none after:content-none",
                    }}
                    {...register("email", {
                      required: "Email is required",
                      pattern: {
                        value: /^\S+@\S+$/i,
                        message: "Invalid email address",
                      },
                    })}
                  />
                  {errors.email && (
                    <p className="text-red-500">{errors.email.message}</p>
                  )}

                  <Typography variant="h6" color="blue-gray" className="-mb-3">
                    Password
                  </Typography>
                  <Input
                    type="password"
                    name="password"
                    size="lg"
                    placeholder="********"
                    className="border-t-blue-gray-200 focus:border-t-gray-900"
                    labelProps={{
                      className: "before:content-none after:content-none",
                    }}
                    {...register("password", {
                      required: "Password is required",
                      minLength: {
                        value: 6,
                        message: "Password must be at least 6 characters",
                      },
                      pattern: {
                        value: /^(?=.*[A-Z])(?=.*\d).+$/,
                        message:
                          "Password must contain at least one uppercase letter and one number",
                      },
                    })}
                  />
                  {errors.password && (
                    <p className="text-red-500">{errors.password.message}</p>
                  )}
                </div>

                <Button className="mt-6 bg-[#3DBDEC]" fullWidth type="submit">
                  Log In
                </Button>

                <Typography className="mt-4 text-center">
                  Or Log In with
                </Typography>

                <SocialLogin/>

                <Typography className="mt-4 text-center font-normal">
                  New in this website?{"  "}
                  <Link to={`/signup`} className="font-medium text-[#3DBDEC]">
                    Sign up
                  </Link>
                </Typography>
              </form>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
};

export default Login;
